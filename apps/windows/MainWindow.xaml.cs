using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Win32;

namespace OmniSync;
public record Clip(string id, string text);
public record Device(string id, string name);
public record Transfer(string id, string name, long size, long offset, string status, string sha256);

public sealed class Api : IDisposable {
    readonly HttpClient http = new(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false });
    public string Origin { get; }
    public string? Token { get; set; }
    public Api(string origin, string? token = null) {
        var uri = new Uri(origin.TrimEnd('/'));
        if (uri.UserInfo.Length > 0 || uri.Query.Length > 0 || uri.Fragment.Length > 0 || uri.AbsolutePath != "/" ||
            (uri.Scheme != "https" && !(uri.Scheme == "http" && new[] { "localhost", "127.0.0.1", "[::1]" }.Contains(uri.Host))))
            throw new Exception("Use an HTTPS server origin, or HTTP on localhost only.");
        Origin = uri.GetLeftPart(UriPartial.Authority); Token = token; http.Timeout = TimeSpan.FromMinutes(10);
    }
    public async Task<HttpResponseMessage> Request(string path, HttpMethod method, object? body = null, Dictionary<string, string>? headers = null) {
        using var request = new HttpRequestMessage(method, Origin + "/api" + path);
        request.Headers.Add("X-Omni-Client", "1"); request.Headers.Add("X-Omni-Cli", "1");
        if (Token != null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        if (body is byte[] binary) { request.Content = new ByteArrayContent(binary); request.Content.Headers.ContentType = new("application/octet-stream"); }
        else if (body != null) request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        if (headers != null) foreach (var (key, value) in headers) request.Headers.Add(key, value);
        var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
        if (!response.IsSuccessStatusCode) { var text = await response.Content.ReadAsStringAsync(); response.Dispose(); throw new Exception(JsonNode.Parse(text)?["error"]?.GetValue<string>() ?? "Workspace request failed."); }
        return response;
    }
    public async Task<JsonNode> Json(string path, HttpMethod? method = null, object? body = null) {
        using var response = await Request(path, method ?? HttpMethod.Get, body);
        return JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
    }
    public async Task Upload(string path) {
        await using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1048576, true);
        var checksum = Convert.ToHexString(await SHA256.HashDataAsync(file)).ToLowerInvariant();
        var transfer = (await Json("/transfers", HttpMethod.Post, new { name = Path.GetFileName(path), size = file.Length, sha256 = checksum })).Deserialize<Transfer>()!;
        file.Position = transfer.offset; long offset = transfer.offset;
        byte[] buffer = new byte[1048576]; int read;
        while ((read = await file.ReadAsync(buffer)) > 0) {
            byte[] chunk = buffer[..read];
            using var response = await Request($"/transfers/{transfer.id}/chunk", HttpMethod.Put, chunk, new() { ["X-Offset"] = offset.ToString(), ["X-Chunk-SHA256"] = Convert.ToHexString(SHA256.HashData(chunk)).ToLowerInvariant() });
            offset = JsonNode.Parse(await response.Content.ReadAsStringAsync())!["offset"]!.GetValue<long>();
        }
        await Json($"/transfers/{transfer.id}/complete", HttpMethod.Post, new { });
    }
    public async Task Download(Transfer transfer, string destination) {
        if (File.Exists(destination)) throw new Exception("Choose a new filename; existing files are never overwritten.");
        string partial = destination + ".omni-part";
        using var response = await Request($"/transfers/{transfer.id}/download", HttpMethod.Get);
        try {
            await using (var file = new FileStream(partial, FileMode.CreateNew, FileAccess.Write)) { await response.Content.CopyToAsync(file); }
            await using (var file = File.OpenRead(partial)) { if (Convert.ToHexString(await SHA256.HashDataAsync(file)).ToLowerInvariant() != transfer.sha256) throw new Exception("Download checksum mismatch."); }
            File.Move(partial, destination);
        } catch { if (File.Exists(partial)) File.Delete(partial); throw; }
    }
    public void Dispose() => http.Dispose();
}

public partial class MainWindow : Window {
    Api? api;
    bool working;
    bool refreshing;
    readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromSeconds(5) };
    readonly string config = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OmniSync", "device.json");
    public MainWindow() {
        InitializeComponent();
        DeviceName.Text = Environment.MachineName;
        try {
            if (File.Exists(config)) {
                var saved = JsonNode.Parse(File.ReadAllText(config))!;
                string token = Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(saved["credential"]!.GetValue<string>()), null, DataProtectionScope.CurrentUser));
                api = new(saved["origin"]!.GetValue<string>(), token); ShowWorkspace();
            }
        } catch (Exception error) { Status.Text = error.Message; }
        timer.Tick += async (_, _) => await Refresh(); timer.Start();
        Loaded += async (_, _) => await Refresh();
        Closed += (_, _) => { timer.Stop(); api?.Dispose(); };
    }
    void ShowWorkspace() { Pairing.Visibility = Visibility.Collapsed; Actions.Visibility = Tabs.Visibility = Visibility.Visible; }
    async Task Run(Func<Task> task) { if (working) return; working = true; Actions.IsEnabled = false; try { await task(); await Refresh(); } catch (Exception e) { Status.Text = e.Message; } finally { working = false; Actions.IsEnabled = true; } }
    async Task Refresh() {
        if (api == null || refreshing) return;
        refreshing = true;
        try {
            var state = await api.Json("/state");
            string? clipId = (Clips.SelectedItem as Clip)?.id, fileId = (Files.SelectedItem as Transfer)?.id;
            var clips = state["clips"]!.Deserialize<List<Clip>>()!;
            var files = state["transfers"]!.Deserialize<List<Transfer>>()!.Where(t => t.status == "ready").ToList();
            Clips.ItemsSource = clips; Files.ItemsSource = files; Devices.ItemsSource = state["devices"]!.Deserialize<List<Device>>();
            Clips.SelectedItem = clips.Find(c => c.id == clipId); Files.SelectedItem = files.Find(f => f.id == fileId);
            Status.Text = $"{state["space"]!["name"]} · {state["me"]!["name"]} · Connected";
        } catch (Exception e) { Status.Text = e.Message; } finally { refreshing = false; }
    }
    async void Pair(object sender, RoutedEventArgs e) => await Run(async () => {
        var candidate = new Api(ServerAddress.Text);
        var joined = await candidate.Json("/join", HttpMethod.Post, new { name = DeviceName.Text, code = PairingCode.Text, platform = "Windows" });
        candidate.Token = joined["token"]!.GetValue<string>();
        byte[] encrypted = ProtectedData.Protect(Encoding.UTF8.GetBytes(candidate.Token), null, DataProtectionScope.CurrentUser);
        Directory.CreateDirectory(Path.GetDirectoryName(config)!);
        File.WriteAllText(config, JsonSerializer.Serialize(new { origin = candidate.Origin, credential = Convert.ToBase64String(encrypted) }));
        api?.Dispose(); api = candidate; PairingCode.Clear(); ShowWorkspace();
    });
    async void SendClipboard(object sender, RoutedEventArgs e) => await Run(async () => { if (api != null && Clipboard.ContainsText()) await api.Json("/clipboard", HttpMethod.Post, new { text = Clipboard.GetText() }); });
    async void ShareText(object sender, RoutedEventArgs e) => await Run(async () => { if (api != null) { await api.Json("/clipboard", HttpMethod.Post, new { text = Snippet.Text }); Snippet.Clear(); } });
    void CopySelected(object sender, RoutedEventArgs e) { if (Clips.SelectedItem is Clip clip) try { Clipboard.SetText(clip.text); Status.Text = "Copied to clipboard."; } catch (Exception error) { Status.Text = error.Message; } }
    async void SendFile(object sender, RoutedEventArgs e) { var picker = new OpenFileDialog(); if (picker.ShowDialog() == true && api != null) await Run(async () => { Status.Text = "Uploading and verifying…"; await api.Upload(picker.FileName); }); }
    async void FileDropped(object sender, DragEventArgs e) { if (api != null && e.Data.GetData(DataFormats.FileDrop) is string[] paths) await Run(async () => { foreach (var path in paths.Where(File.Exists)) await api.Upload(path); }); }
    async void DownloadFile(object sender, RoutedEventArgs e) { if (Files.SelectedItem is not Transfer transfer || api == null) return; var picker = new SaveFileDialog { FileName = transfer.name }; if (picker.ShowDialog() == true) await Run(() => api.Download(transfer, picker.FileName)); }
    void OpenWorkspace(object sender, RoutedEventArgs e) { if (api != null) Process.Start(new ProcessStartInfo(api.Origin) { UseShellExecute = true }); }
}
