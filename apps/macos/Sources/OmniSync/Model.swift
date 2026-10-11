import AppKit
import OmniCore
import OmniMacSupport
import ServiceManagement
import SwiftUI

@MainActor final class Model: ObservableObject {
  @Published private(set) var state: Workspace?
  @Published private(set) var status = "Pair with your workspace to get started."
  @Published var error: String?
  @Published var server = UserDefaults.standard.string(forKey: "server") ?? "http://127.0.0.1:47800"
  @Published var name = Host.current().localizedName ?? "My Mac"
  @Published var code = ""
  @Published var text = ""
  @Published var target = ""
  @Published private(set) var busy = false
  @Published private(set) var progress: TransferProgress?
  @Published private(set) var isDownloading = false
  @Published private(set) var connected = false
  @Published private(set) var hasSession = false
  @Published private(set) var loginEnabled = SMAppService.mainApp.status == .enabled
  @Published private(set) var loginNeedsApproval = SMAppService.mainApp.status == .requiresApproval
  private var api: OmniAPI?
  private var operation: Task<Void, Never>?
  private var polling: Task<Void, Never>?
  private var refreshing = false
  private var generation = UUID()

  var canSendClipboard: Bool {
    connected && state?.me.canWrite == true && state?.me.permissions.clipboard == true
  }
  var canSendFiles: Bool {
    connected && state?.me.canWrite == true && state?.me.permissions.files == true
  }
  var recipients: [Device] { state?.devices.filter { $0.id != state?.me.id } ?? [] }

  init() {
    if ProcessInfo.processInfo.arguments.contains("--omnisync-smoke-test") {
      // CI startup does not read a user's Keychain or contact a saved workspace.
      server = "http://127.0.0.1:47800"
      status = "Application startup check."
    } else {
      reconnect()
    }
  }

  func startPolling() {
    guard polling == nil else { return }
    polling = Task { [weak self] in
      while !Task.isCancelled {
        await self?.refresh()
        do { try await Task.sleep(nanoseconds: 5_000_000_000) } catch { break }
      }
    }
  }

  func reconnect() {
    guard !busy else { return }
    do {
      // Preserve the previous version's Keychain account spelling during migration.
      if let token = try Vault.read(server) {
        api = try OmniAPI(server: server, token: token)
        hasSession = true
        Task { await refresh() }
      } else {
        status = "Enter a fresh invitation code from the web workspace."
      }
    } catch { self.error = error.localizedDescription }
  }

  func refresh() async {
    guard let api, !refreshing, !busy else { return }
    refreshing = true
    let current = generation
    defer { refreshing = false }
    do {
      let updated = try await api.state()
      guard current == generation else { return }
      state = updated
      connected = true
      if !target.isEmpty && !updated.devices.contains(where: { $0.id == target }) { target = "" }
      status = "Connected · \(updated.devices.count) paired devices"
    } catch {
      guard current == generation else { return }
      connected = false
      if (error as? APIError)?.status == 401 {
        state = nil
        self.api = nil
        hasSession = false
        status = "This session expired or was revoked. Request a new invitation to pair again."
      } else {
        status = "Workspace unavailable. Retrying… \(error.localizedDescription)"
      }
    }
  }

  private func perform(_ action: @escaping @MainActor () async throws -> Void) {
    guard !busy else { return }
    busy = true
    error = nil
    operation = Task {
      defer {
        busy = false
        progress = nil
        isDownloading = false
        operation = nil
      }
      do {
        try await action()
        busy = false
        await refresh()
      } catch is CancellationError {
        status = "Operation cancelled. Reselect the same file and recipient to resume an upload."
      } catch let failure as URLError where failure.code == .cancelled {
        status = "Operation cancelled. Reselect the same file and recipient to resume an upload."
      } catch { self.error = error.localizedDescription }
    }
  }

  func pair() {
    perform {
      let origin = try ServerOrigin.parse(self.server).absoluteString
      let api = try OmniAPI(server: origin, token: nil)
      let token = try await api.pair(
        code: self.code, name: self.name.trimmingCharacters(in: .whitespacesAndNewlines))
      try Vault.save(token, server: origin)
      self.generation = UUID()
      self.server = origin
      UserDefaults.standard.set(origin, forKey: "server")
      self.api = api
      self.hasSession = true
      self.code = ""
    }
  }

  func forget() {
    guard !busy else { return }
    do {
      try Vault.remove(server)
      generation = UUID()
      api = nil
      state = nil
      connected = false
      hasSession = false
      text = ""
      code = ""
      target = ""
      error = nil
      status = "Local session removed. The owner can revoke the old device in the web workspace."
    } catch { self.error = error.localizedDescription }
  }

  func sendClipboard() {
    guard canSendClipboard else { return }
    guard let text = NSPasteboard.general.string(forType: .string), !text.isEmpty else {
      error = "The clipboard has no text to share."
      return
    }
    share(text)
  }

  func share(_ value: String) {
    guard canSendClipboard, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return
    }
    let recipient = target.isEmpty ? nil : target
    perform {
      guard let api = self.api else { return }
      try await api.share(value, target: recipient)
      if self.text == value { self.text = "" }
    }
  }

  func sendFiles(_ urls: [URL]) {
    guard canSendFiles, !urls.isEmpty else { return }
    let recipient = target.isEmpty ? nil : target
    perform {
      guard let api = self.api else { return }
      for url in urls {
        try Task.checkCancellation()
        self.status = "Sending \(url.lastPathComponent)…"
        try await api.upload(url, target: recipient) { progress in
          await MainActor.run { self.progress = progress }
        }
      }
    }
  }

  func chooseFiles() {
    guard canSendFiles, !busy else { return }
    let panel = NSOpenPanel()
    panel.canChooseDirectories = false
    panel.allowsMultipleSelection = true
    panel.prompt = "Send"
    if panel.runModal() == .OK { sendFiles(panel.urls) }
  }

  func save(_ transfer: Transfer) {
    guard !busy else { return }
    let panel = NSSavePanel()
    panel.nameFieldStringValue = transfer.name
    panel.canCreateDirectories = true
    guard panel.runModal() == .OK, let url = panel.url else { return }
    // NSSavePanel obtains explicit overwrite consent before returning OK.
    let overwrite = FileManager.default.fileExists(atPath: url.path)
    perform {
      guard let api = self.api else { return }
      self.status = "Downloading \(transfer.name)…"
      self.isDownloading = true
      try await api.download(transfer, destination: url, overwrite: overwrite) { progress in
        await MainActor.run { self.progress = progress }
      }
      NSWorkspace.shared.activateFileViewerSelecting([url])
    }
  }

  func cancel() { operation?.cancel() }
  func openWeb() { if let url = try? ServerOrigin.parse(server) { NSWorkspace.shared.open(url) } }

  func setLoginEnabled(_ enabled: Bool) {
    do {
      if enabled {
        try SMAppService.mainApp.register()
      } else {
        try SMAppService.mainApp.unregister()
      }
      loginEnabled = SMAppService.mainApp.status == .enabled
      loginNeedsApproval = SMAppService.mainApp.status == .requiresApproval
    } catch {
      self.error =
        "Could not change launch at login. Install the app in Applications first. \(error.localizedDescription)"
    }
  }
}
