package dev.omnisync

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.core.net.toUri
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private var api: OmniApi? = null
    private var workspace by mutableStateOf<JSONObject?>(null)
    private var status by mutableStateOf("Pair with your local workspace.")
    private var busy by mutableStateOf(false)
    private var draft by mutableStateOf("")
    private var pendingShare: Uri? = null
    private var download: JSONObject? = null
    private val openFile = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let { upload(it) } }
    private val saveFile = registerForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val transfer = download; if (uri != null && transfer != null) perform { api?.download(this, transfer, uri) }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        api = runCatching { SessionVault(this).load() }.getOrNull()
        if (intent.action == Intent.ACTION_SEND) {
            draft = intent.getStringExtra(Intent.EXTRA_TEXT) ?: ""
            @Suppress("DEPRECATION")
            pendingShare = intent.getParcelableExtra(Intent.EXTRA_STREAM)
        }
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) { if (api != null && !busy) refresh(); delay(5000) }
            }
        }
        setContent {
            MaterialTheme(colorScheme = lightColorScheme(primary = Color(0xFF315D43), background = Color(0xFFF5F8F1), surface = Color(0xFFF5F8F1))) {
                Surface(Modifier.fillMaxSize()) { WorkspaceUI() }
            }
        }
    }
    private suspend fun refresh() {
        try { workspace = withContext(Dispatchers.IO) { api?.json("/state") }; status = "Connected to ${workspace?.getJSONObject("space")?.getString("name") ?: "workspace"}" }
        catch (error: Exception) { status = error.message ?: "Connection unavailable." }
    }
    private fun perform(work: () -> Unit) {
        if (busy) return
        busy = true
        lifecycleScope.launch {
            try { withContext(Dispatchers.IO) { work() }; refresh() }
            catch (error: Exception) { status = error.message ?: "The request failed." }
            finally { busy = false }
        }
    }
    private fun upload(uri: Uri) { status = "Uploading and verifying…"; perform { api?.upload(this, uri) } }
    @Composable private fun WorkspaceUI() {
        var server by remember { mutableStateOf("https://desktop.example:47800") }
        var name by remember { mutableStateOf(android.os.Build.MODEL) }
        var code by remember { mutableStateOf("") }
        val state = workspace
        LazyColumn(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item { Text("omnisync.", style = MaterialTheme.typography.headlineLarge, color = MaterialTheme.colorScheme.primary) }
            item { Text(status, style = MaterialTheme.typography.bodySmall) }
            if (busy) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
            if (state == null) {
                item { OutlinedTextField(server, { server = it }, label = { Text("Workspace HTTPS address") }, modifier = Modifier.fillMaxWidth(), singleLine = true) }
                item { OutlinedTextField(name, { name = it }, label = { Text("Device name") }, modifier = Modifier.fillMaxWidth(), singleLine = true) }
                item { OutlinedTextField(code, { code = it }, label = { Text("Pairing code") }, modifier = Modifier.fillMaxWidth(), singleLine = true) }
                item { Button(enabled = !busy, onClick = { perform { val candidate = OmniApi(server); candidate.pair(code, name); SessionVault(this@MainActivity).save(candidate.origin, candidate.token!!); api = candidate } }) { Text("Pair this phone") } }
                item { Text("Create a single-use pairing code from Add device in the web workspace. Your session is encrypted with a key held in Android Keystore.", style = MaterialTheme.typography.bodySmall) }
            } else {
                item { Text(state.getJSONObject("space").getString("name"), style = MaterialTheme.typography.titleLarge) }
                item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(enabled = !busy, onClick = {
                        val clipboard = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
                        val text = clipboard.primaryClip?.getItemAt(0)?.coerceToText(this@MainActivity)?.toString()
                        if (!text.isNullOrBlank()) draft = text else status = "No text in your clipboard."
                    }) { Text("Paste clipboard") }
                    Button(enabled = !busy, onClick = { openFile.launch(arrayOf("*/*")) }) { Text("Send file") }
                } }
                if (pendingShare != null) item { Button(onClick = { pendingShare?.let { upload(it) }; pendingShare = null }, enabled = !busy) { Text("Send file shared to OmniSync") } }
                item { OutlinedTextField(draft, { draft = it }, label = { Text("Share text or a link") }, modifier = Modifier.fillMaxWidth()) }
                item { Button(enabled = !busy && draft.isNotBlank(), onClick = { val text = draft; perform { api?.share(text) }; draft = "" }) { Text("Share clipboard item") } }
                item { Text("Shared clipboard", style = MaterialTheme.typography.titleMedium) }
                for (clip in state.getJSONArray("clips").objects()) item(key = clip.getString("id")) {
                    Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(15.dp)) {
                        Text(clip.getString("text"), maxLines = 8)
                        TextButton(onClick = { (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("OmniSync", clip.getString("text"))); status = "Copied to clipboard." }) { Text("Copy") }
                    } }
                }
                item { Text("Files", style = MaterialTheme.typography.titleMedium) }
                for (file in state.getJSONArray("transfers").objects().filter { it.getString("status") == "ready" }) item(key = file.getString("id")) {
                    OutlinedButton(modifier = Modifier.fillMaxWidth(), enabled = !busy, onClick = { download = file; saveFile.launch(file.getString("name")) }) { Text("Download ${file.getString("name")}") }
                }
                item { Text("Your devices", style = MaterialTheme.typography.titleMedium) }
                for (device in state.getJSONArray("devices").objects()) item { Text("${device.getString("name")} · ${device.getString("platform")}") }
                item { OutlinedButton(onClick = { startActivity(Intent(Intent.ACTION_VIEW, api!!.origin.toUri())) }) { Text("Open full web workspace") } }
                item { Text("Clipboard access is manual and only while this app is visible. Keep the app open during transfers. Screen sharing and chat are available in the web workspace.", style = MaterialTheme.typography.bodySmall) }
            }
        }
    }
}
private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
