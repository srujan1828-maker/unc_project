import AppKit
import OmniCore
import ServiceManagement
import SwiftUI
import UniformTypeIdentifiers

@MainActor struct WorkspaceView: View {
  @ObservedObject var model: Model
  @State private var confirmForget = false
  @State private var dragTarget = false

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Label("OmniSync", systemImage: "square.on.square").font(.largeTitle.weight(.semibold))
        Spacer()
        if model.hasSession {
          Button("Refresh") { Task { await model.refresh() } }.disabled(model.busy)
        }
        Button("Open web workspace", action: model.openWeb)
      }
      Label(model.status, systemImage: model.connected ? "checkmark.circle.fill" : "network")
        .font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
        .accessibilityIdentifier("connectionStatus")
      if let error = model.error {
        HStack(alignment: .top) {
          Label(error, systemImage: "exclamationmark.triangle").textSelection(.enabled)
          Spacer()
          Button("Dismiss") { model.error = nil }
        }.padding(12).background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
      }
      if let state = model.state {
        workspace(state)
      } else if model.hasSession {
        VStack(spacing: 12) {
          ProgressView()
          Text("Connecting to your saved workspace…")
          Text(model.server).font(.caption).textSelection(.enabled)
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        pairing
      }
      if model.busy {
        HStack {
          if let progress = model.progress {
            VStack(alignment: .leading) {
              ProgressView(value: progress.fraction)
              Text(
                "\(progress.phase) · \(ByteCountFormatter.string(fromByteCount: Int64(progress.completed), countStyle: .file)) of \(ByteCountFormatter.string(fromByteCount: Int64(progress.total), countStyle: .file))"
              )
              .font(.caption).monospacedDigit()
            }
          } else {
            ProgressView().controlSize(.small)
            Text(model.isDownloading ? "Downloading…" : "Working…")
          }
          Button("Cancel", action: model.cancel).keyboardShortcut(".", modifiers: .command)
        }.padding(12).background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
      }
      Divider()
      HStack {
        Toggle(
          "Launch at login", isOn: Binding(get: { model.loginEnabled }, set: model.setLoginEnabled)
        )
        .toggleStyle(.checkbox)
        if model.loginNeedsApproval {
          Button("Approve in System Settings") { SMAppService.openSystemSettingsLoginItems() }
        }
        Spacer()
        Button("Forget this connection…") { confirmForget = true }.disabled(model.busy)
      }.font(.caption)
    }
    .padding(24).frame(minWidth: 680, minHeight: 570)
    .background(dragTarget ? Color.accentColor.opacity(0.08) : Color.clear)
    .task { model.startPolling() }
    .confirmationDialog(
      "Remove this Mac’s locally saved session?", isPresented: $confirmForget,
      titleVisibility: .visible
    ) {
      Button("Forget connection", role: .destructive, action: model.forget)
    } message: {
      Text(
        "You will need a new invitation to reconnect. The owner can revoke this device from the web workspace. Shared files remain on the service."
      )
    }
    .onDrop(of: [UTType.fileURL.identifier], isTargeted: $dragTarget) { providers in
      guard model.canSendFiles, !model.busy, !providers.isEmpty else { return false }
      // Load provider data off the UI thread, then submit the whole selection once.
      Task { @MainActor in
        var urls: [URL] = []
        for provider in providers {
          let url: URL? = await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) {
              item, _ in
              if let data = item as? Data {
                continuation.resume(returning: URL(dataRepresentation: data, relativeTo: nil))
              } else {
                continuation.resume(returning: item as? URL)
              }
            }
          }
          if let url, url.isFileURL { urls.append(url) }
        }
        if urls.isEmpty {
          model.error = "Drop local files here, or use Send files to select them."
        } else {
          model.sendFiles(urls)
        }
      }
      return true
    }
  }

  private var pairing: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Bring this Mac into your workspace").font(.title2)
      Text(
        "Create an invitation with Add device in the web workspace. Your session is stored in macOS Keychain."
      ).foregroundStyle(.secondary)
      TextField("Workspace HTTPS address", text: $model.server).accessibilityIdentifier(
        "serverAddress")
      TextField("Device name", text: $model.name)
      SecureField("Pairing code", text: $model.code).onSubmit {
        if !model.code.isEmpty { model.pair() }
      }
      HStack {
        Button("Pair this Mac", action: model.pair).buttonStyle(.borderedProminent)
          .disabled(
            model.busy || model.code.isEmpty
              || model.name.trimmingCharacters(in: .whitespaces).isEmpty)
        Button("Retry saved Keychain session", action: model.reconnect).disabled(model.busy)
      }
      Text(
        "This companion connects to an existing OmniSync service. Run the service on this Mac or another trusted device using the project README."
      ).font(.caption).foregroundStyle(.secondary)
    }.textFieldStyle(.roundedBorder).padding(.vertical, 24).frame(
      maxHeight: .infinity, alignment: .top)
  }

  private func workspace(_ state: Workspace) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text(state.space.name).font(.title2)
        Spacer()
        Text(state.me.role.capitalized).font(.caption).foregroundStyle(.secondary)
      }
      HStack {
        Picker("Send to", selection: $model.target) {
          Text("Entire workspace").tag("")
          ForEach(model.recipients) { device in Text(device.name).tag(device.id) }
        }.frame(maxWidth: 280).disabled(model.busy)
        Spacer()
        Button("Send clipboard", action: model.sendClipboard).disabled(
          model.busy || !model.canSendClipboard)
        Button("Send files…", action: model.chooseFiles).disabled(model.busy || !model.canSendFiles)
      }
      HStack {
        TextField("Share a thought or link…", text: $model.text).textFieldStyle(.roundedBorder)
          .onSubmit { model.share(model.text) }.disabled(!model.canSendClipboard)
        Button("Share") { model.share(model.text) }.disabled(
          model.busy || !model.canSendClipboard || model.text.isEmpty)
      }
      List {
        Section("Your devices") {
          ForEach(state.devices) { device in
            HStack {
              Label(
                device.name, systemImage: device.platform == "Android" ? "iphone" : "laptopcomputer"
              )
              Spacer()
              Text(device.platform).foregroundStyle(.secondary)
              Text(device.online == true ? "Online" : "Offline").font(.caption).foregroundStyle(
                .secondary)
            }
          }
        }
        Section("Shared clipboard") {
          if state.clips.isEmpty { Text("Shared text appears here.").foregroundStyle(.secondary) }
          ForEach(state.clips) { clip in
            HStack(alignment: .top) {
              Text(clip.text).lineLimit(4).textSelection(.enabled)
              Spacer()
              Button("Copy") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(clip.text, forType: .string)
              }.accessibilityLabel("Copy shared text")
            }.padding(.vertical, 4)
          }
        }
        Section("Files") {
          if state.transfers.isEmpty {
            Text("Send a file, or drop files into this window.").foregroundStyle(.secondary)
          }
          ForEach(state.transfers) { file in
            HStack {
              Label(file.name, systemImage: "doc")
              Spacer()
              Text(ByteCountFormatter.string(fromByteCount: Int64(file.size), countStyle: .file))
                .foregroundStyle(.secondary)
              if file.status == "ready" {
                Button("Save…") { model.save(file) }.disabled(model.busy || !model.connected)
              } else {
                Text(
                  "\(file.status.capitalized) · \(file.size == 0 ? 0 : Int(Double(file.offset) / Double(file.size) * 100))%"
                ).font(.caption).foregroundStyle(.secondary)
              }
            }.padding(.vertical, 3)
          }
        }
      }.listStyle(.inset)
      Text(
        "Clipboard sharing is manual. Reselect an interrupted upload with the same recipient to resume it."
      )
      .font(.caption).foregroundStyle(.secondary)
    }
  }
}

@MainActor private struct MenuView: View {
  @ObservedObject var model: Model
  @Environment(\.openWindow) private var openWindow
  var body: some View {
    Text(model.state?.space.name ?? "OmniSync")
    Text(model.connected ? "Connected" : "Not connected")
    Button("Show OmniSync") {
      openWindow(id: "workspace")
      NSApp.activate(ignoringOtherApps: true)
    }
    .keyboardShortcut("o", modifiers: .command)
    Divider()
    Button("Send clipboard", action: model.sendClipboard).disabled(
      !model.canSendClipboard || model.busy)
    Button("Send files…", action: model.chooseFiles).disabled(!model.canSendFiles || model.busy)
    Button("Open web workspace", action: model.openWeb)
    Divider()
    Button("Quit OmniSync") { NSApplication.shared.terminate(nil) }.keyboardShortcut(
      "q", modifiers: .command)
  }
}

@main @MainActor struct OmniSyncApp: App {
  @StateObject private var model = Model()
  var body: some Scene {
    Window("OmniSync", id: "workspace") { WorkspaceView(model: model) }
      .defaultSize(width: 860, height: 700)
    MenuBarExtra("OmniSync", systemImage: "square.on.square") { MenuView(model: model) }
  }
}
