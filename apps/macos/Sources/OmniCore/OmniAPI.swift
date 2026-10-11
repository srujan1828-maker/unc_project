import Foundation

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif
#if canImport(CryptoKit)
  import CryptoKit
#else
  import Crypto
#endif

private final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) { completionHandler(nil) }
}

public actor OmniAPI {
  public nonisolated let origin: URL
  private var token: String?
  private let session: URLSession
  private let chunkSize = 1_048_576
  public static let maxFileSize = 1_073_741_824
  public typealias Progress = @Sendable (TransferProgress) async -> Void

  public init(server: String, token: String?) throws {
    origin = try ServerOrigin.parse(server)
    self.token = token
    let config = URLSessionConfiguration.ephemeral
    config.httpShouldSetCookies = false
    config.urlCache = nil
    config.timeoutIntervalForRequest = 60
    config.timeoutIntervalForResource = 3600
    session = URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
  }

  deinit { session.invalidateAndCancel() }

  private func makeRequest(
    _ path: String, method: String = "GET", body: Data? = nil,
    binary: Bool = false, headers: [String: String] = [:]
  ) -> URLRequest {
    // Construct the path on the already validated origin; never follow server redirects.
    var components = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
    components.path = "/api" + path
    var request = URLRequest(url: components.url!)
    request.httpMethod = method
    request.httpBody = body
    request.setValue("1", forHTTPHeaderField: "X-Omni-Client")
    request.setValue("1", forHTTPHeaderField: "X-Omni-Cli")
    request.setValue(
      binary ? "application/octet-stream" : "application/json", forHTTPHeaderField: "Content-Type")
    if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
    for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
    return request
  }

  private func request(
    _ path: String, method: String = "GET", body: Data? = nil,
    binary: Bool = false, headers: [String: String] = [:]
  ) async throws -> Data {
    try Task.checkCancellation()
    let (data, response) = try await session.data(
      for: makeRequest(path, method: method, body: body, binary: binary, headers: headers))
    guard let response = response as? HTTPURLResponse else {
      throw APIError("Invalid workspace response.")
    }
    guard (200..<300).contains(response.statusCode) else {
      let detail = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
      throw APIError(
        detail?["error"] as? String ?? "Workspace request failed (\(response.statusCode)).",
        status: response.statusCode)
    }
    try Task.checkCancellation()
    return data
  }

  private func json(_ path: String, _ object: [String: Any]) async throws -> Data {
    try await request(path, method: "POST", body: JSONSerialization.data(withJSONObject: object))
  }

  public func pair(code: String, name: String) async throws -> String {
    struct Joined: Decodable { let token: String }
    let data = try await json("/join", ["code": code, "name": name, "platform": "macOS"])
    let joined = try JSONDecoder().decode(Joined.self, from: data)
    token = joined.token
    return joined.token
  }

  public func state() async throws -> Workspace {
    try JSONDecoder().decode(Workspace.self, from: await request("/state"))
  }

  public func share(_ text: String, target: String? = nil) async throws {
    var payload: [String: Any] = ["text": text]
    if let target { payload["target"] = target }
    _ = try await json("/clipboard", payload)
  }

  private func checksum(_ url: URL, progress: Progress? = nil, total: Int) async throws -> String {
    let file = try FileHandle(forReadingFrom: url)
    defer { try? file.close() }
    var digest = SHA256()
    var count = 0
    while let data = try file.read(upToCount: chunkSize), !data.isEmpty {
      try Task.checkCancellation()
      count += data.count
      guard count <= Self.maxFileSize else { throw APIError("Files must be 1 GiB or smaller.") }
      digest.update(data: data)
      if let progress {
        await progress(TransferProgress(phase: "Verifying", completed: count, total: total))
      }
    }
    guard count == total else { throw APIError("The file size changed. Select the file again.") }
    return digest.finalize().map { String(format: "%02x", $0) }.joined()
  }

  @discardableResult
  public func upload(_ url: URL, target: String? = nil, progress: Progress? = nil) async throws
    -> Transfer
  {
    #if os(macOS)
      let scoped = url.startAccessingSecurityScopedResource()
      defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    #endif
    let properties = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
    guard properties.isRegularFile == true, let size = properties.fileSize, size <= Self.maxFileSize
    else {
      throw APIError("Select a regular file no larger than 1 GiB. Folders are not supported.")
    }
    let sha256 = try await checksum(url, progress: progress, total: size)
    var offer: [String: Any] = ["name": url.lastPathComponent, "size": size, "sha256": sha256]
    if let target { offer["target"] = target }
    let data = try await json("/transfers", offer)
    let transfer = try JSONDecoder().decode(Transfer.self, from: data)
    guard transfer.offset >= 0, transfer.offset <= size, transfer.size == size else {
      throw APIError("Invalid upload resume offset.")
    }
    let file = try FileHandle(forReadingFrom: url)
    defer { try? file.close() }
    var offset = transfer.offset
    try file.seek(toOffset: UInt64(offset))
    if let progress {
      await progress(TransferProgress(phase: "Uploading", completed: offset, total: size))
    }
    while offset < size {
      try Task.checkCancellation()
      guard let chunk = try file.read(upToCount: min(chunkSize, size - offset)), !chunk.isEmpty
      else {
        throw APIError("The file changed during upload. Select the original file again.")
      }
      let digest = SHA256.hash(data: chunk).map { String(format: "%02x", $0) }.joined()
      let response = try await request(
        "/transfers/\(transfer.id)/chunk", method: "PUT", body: chunk, binary: true,
        headers: ["X-Offset": String(offset), "X-Chunk-SHA256": digest])
      struct Offset: Decodable { let offset: Int }
      let next = try JSONDecoder().decode(Offset.self, from: response).offset
      guard next == offset + chunk.count else {
        throw APIError("The workspace returned an invalid chunk acknowledgment.")
      }
      offset = next
      if let progress {
        await progress(TransferProgress(phase: "Uploading", completed: offset, total: size))
      }
    }
    let completed = try await json("/transfers/\(transfer.id)/complete", [:])
    return try JSONDecoder().decode(Transfer.self, from: completed)
  }

  public func download(
    _ transfer: Transfer, destination: URL, overwrite: Bool = false, progress: Progress? = nil
  ) async throws {
    guard transfer.size >= 0, transfer.size <= Self.maxFileSize else {
      throw APIError("Invalid file size.")
    }
    #if os(macOS)
      let scoped = destination.startAccessingSecurityScopedResource()
      defer { if scoped { destination.stopAccessingSecurityScopedResource() } }
    #endif
    try Task.checkCancellation()
    if FileManager.default.fileExists(atPath: destination.path) && !overwrite {
      throw APIError("A file already exists at that location. Choose another name.")
    }
    let (temporary, response) = try await session.download(
      for: makeRequest("/transfers/\(transfer.id)/download"))
    defer { try? FileManager.default.removeItem(at: temporary) }
    guard let response = response as? HTTPURLResponse, response.statusCode == 200 else {
      throw APIError(
        "The file is no longer available.", status: (response as? HTTPURLResponse)?.statusCode)
    }
    guard try await checksum(temporary, progress: progress, total: transfer.size) == transfer.sha256
    else {
      throw APIError("Download checksum mismatch. The destination was not changed.")
    }
    try Task.checkCancellation()
    // Stage in the destination directory so the final rename stays on one volume.
    let staged = destination.deletingLastPathComponent().appendingPathComponent(
      ".omnisync-\(UUID().uuidString).partial")
    defer { try? FileManager.default.removeItem(at: staged) }
    try FileManager.default.copyItem(at: temporary, to: staged)
    let handle = try FileHandle(forWritingTo: staged)
    do {
      try handle.synchronize()
      try handle.close()
    } catch {
      try? handle.close()
      throw error
    }
    try Task.checkCancellation()
    if overwrite && FileManager.default.fileExists(atPath: destination.path) {
      _ = try FileManager.default.replaceItemAt(destination, withItemAt: staged)
    } else {
      try FileManager.default.moveItem(at: staged, to: destination)
    }
  }
}
