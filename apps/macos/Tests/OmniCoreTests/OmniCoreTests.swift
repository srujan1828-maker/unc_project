import Foundation
import XCTest

@testable import OmniCore

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

final class OmniCoreTests: XCTestCase {
  func testOriginValidationAndNormalization() throws {
    XCTAssertEqual(
      try ServerOrigin.parse(" HTTPS://EXAMPLE.COM:443/ \n").absoluteString, "https://example.com")
    XCTAssertEqual(
      try ServerOrigin.parse("http://localhost:47800/").absoluteString, "http://localhost:47800")
    XCTAssertEqual(
      try ServerOrigin.parse("http://[::1]:47800/").absoluteString, "http://[::1]:47800")
    for invalid in [
      "http://192.168.1.10", "https://user:password@example.com", "https://example.com/api",
      "https://example.com?token=secret", "https://example.com#token", "ftp://localhost",
      "https://example.com:0", "not a URL",
    ] {
      XCTAssertThrowsError(try ServerOrigin.parse(invalid), invalid)
    }
  }

  func testReadOnlyRolesAndPermissionsDecode() throws {
    let observer = try JSONDecoder().decode(
      Device.self,
      from: Data(
        """
        {"id":"a","name":"Observer","platform":"macOS","role":"observer","permissions":{"files":true,"clipboard":true},"online":true}
        """.utf8))
    XCTAssertFalse(observer.canWrite)
    XCTAssertTrue(observer.permissions.files)
    let member = try JSONDecoder().decode(
      Device.self,
      from: Data(
        """
        {"id":"b","name":"Member","platform":"macOS","role":"member","permissions":{"files":false,"clipboard":true},"online":false}
        """.utf8))
    XCTAssertTrue(member.canWrite)
    XCTAssertFalse(member.permissions.files)
  }

  func testNativeTransportAgainstRealService() async throws {
    guard let path = ProcessInfo.processInfo.environment["OMNI_SWIFT_FIXTURE"] else {
      throw XCTSkip("Run node tools/test-macos.js to supply an isolated real service.")
    }
    let fixture = try JSONDecoder().decode(
      Fixture.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
    let api = try OmniAPI(server: fixture.origin, token: nil)
    let token = try await api.pair(code: fixture.code, name: "Swift integration Mac")
    XCTAssertFalse(token.isEmpty)
    let state = try await api.state()
    XCTAssertEqual(state.me.platform, "macOS")
    try await api.share("Swift clipboard · café 👋", target: fixture.ownerID)
    let owner = try OmniAPI(server: fixture.origin, token: fixture.ownerToken)
    let ownerState = try await owner.state()
    XCTAssertEqual(ownerState.clips.first?.text, "Swift clipboard · café 👋")

    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let source = directory.appendingPathComponent("swift-payload.bin")
    let content = Data((0..<(2 * 1_048_576 + 17)).map { UInt8($0 % 251) })
    try content.write(to: source)

    // Cancel after an acknowledged chunk, then reselect to exercise actual resume.
    let interrupted = Task {
      try await api.upload(source) { progress in
        if progress.phase == "Uploading" && progress.completed >= 1_048_576 {
          withUnsafeCurrentTask { $0?.cancel() }
        }
      }
    }
    do {
      _ = try await interrupted.value
      XCTFail("Upload should stop on cancellation")
    } catch {
      XCTAssertTrue(error is CancellationError || (error as? URLError)?.code == .cancelled)
    }
    let interruptedState = try await api.state()
    let pending = try XCTUnwrap(
      interruptedState.transfers.first { $0.name == source.lastPathComponent })
    XCTAssertEqual(pending.offset, 1_048_576)
    XCTAssertEqual(pending.status, "uploading")
    let transfer = try await api.upload(source)
    XCTAssertEqual(transfer.id, pending.id)
    XCTAssertEqual(transfer.status, "ready")
    let destination = directory.appendingPathComponent("received.bin")
    try await owner.download(transfer, destination: destination)
    XCTAssertEqual(try Data(contentsOf: destination), content)
    do {
      try await api.download(transfer, destination: destination)
      XCTFail("Existing file must be preserved")
    } catch { XCTAssertEqual(try Data(contentsOf: destination), content) }

    let metadata: [String: Any] = [
      "id": transfer.id, "name": transfer.name, "size": transfer.size,
      "offset": transfer.offset, "status": transfer.status,
      "sha256": String(repeating: "0", count: 64),
    ]
    let corrupt = try JSONDecoder().decode(
      Transfer.self, from: JSONSerialization.data(withJSONObject: metadata))
    let rejected = directory.appendingPathComponent("must-not-exist.bin")
    do {
      try await api.download(corrupt, destination: rejected)
      XCTFail("Corrupt digest must be rejected")
    } catch { XCTAssertFalse(FileManager.default.fileExists(atPath: rejected.path)) }
    do {
      try await api.download(corrupt, destination: destination, overwrite: true)
      XCTFail("A corrupt download must never replace an existing file")
    } catch { XCTAssertEqual(try Data(contentsOf: destination), content) }
    #if os(macOS)
      try Data("previous contents".utf8).write(to: destination)
      try await api.download(transfer, destination: destination, overwrite: true)
      XCTAssertEqual(try Data(contentsOf: destination), content)
    #endif
    XCTAssertFalse(
      try FileManager.default.contentsOfDirectory(atPath: directory.path).contains {
        $0.hasSuffix(".partial")
      })

    let empty = directory.appendingPathComponent("empty.txt")
    try Data().write(to: empty)
    let emptyTransfer = try await api.upload(empty)
    XCTAssertEqual(emptyTransfer.size, 0)
    let emptyDestination = directory.appendingPathComponent("empty-received.txt")
    try await api.download(emptyTransfer, destination: emptyDestination)
    XCTAssertEqual(try Data(contentsOf: emptyDestination).count, 0)

    var revoke = URLRequest(url: URL(string: fixture.origin + "/api/devices/" + state.me.id)!)
    revoke.httpMethod = "DELETE"
    revoke.setValue("Bearer " + fixture.ownerToken, forHTTPHeaderField: "Authorization")
    revoke.setValue("1", forHTTPHeaderField: "X-Omni-Client")
    let (_, response) = try await URLSession.shared.data(for: revoke)
    XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
    do {
      _ = try await api.state()
      XCTFail("Revoked session must fail")
    } catch { XCTAssertEqual((error as? APIError)?.status, 401) }
  }

  func testRedirectCannotForwardSessionToAnotherOrigin() async throws {
    guard let path = ProcessInfo.processInfo.environment["OMNI_SWIFT_FIXTURE"] else {
      throw XCTSkip("Run node tools/test-macos.js for redirect fixtures.")
    }
    let fixture = try JSONDecoder().decode(
      Fixture.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
    let api = try OmniAPI(
      server: fixture.redirectOrigin, token: "dummy-token-must-not-be-forwarded")
    do {
      _ = try await api.state()
      XCTFail("Redirect must be rejected")
    } catch { XCTAssertEqual((error as? APIError)?.status, 302) }
    let (data, _) = try await URLSession.shared.data(
      from: URL(string: fixture.receiverOrigin + "/count")!)
    XCTAssertEqual(String(data: data, encoding: .utf8), "0")
  }

  func testOversizedFilesAndDirectoriesFailBeforeNetworkAccess() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let api = try OmniAPI(server: "http://127.0.0.1:1", token: nil)
    let source = directory.appendingPathComponent("too-large.bin")
    try Data().write(to: source)
    let handle = try FileHandle(forWritingTo: source)
    try handle.truncate(atOffset: UInt64(OmniAPI.maxFileSize) + 1)
    try handle.close()
    for url in [directory, source] {
      do {
        _ = try await api.upload(url)
        XCTFail("Unsupported file must be rejected")
      } catch { XCTAssertTrue((error as? APIError)?.message.contains("regular file") == true) }
    }
  }

  private struct Fixture: Decodable {
    let origin: String
    let code: String
    let ownerToken: String
    let ownerID: String
    let redirectOrigin: String
    let receiverOrigin: String
  }
}
