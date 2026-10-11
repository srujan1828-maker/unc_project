import Foundation

public struct Permissions: Decodable, Sendable {
  public let clipboard: Bool
  public let files: Bool
}

public struct Device: Decodable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let platform: String
  public let role: String
  public let permissions: Permissions
  public let online: Bool?
  public var canWrite: Bool { role == "owner" || role == "member" }
}

public struct Clip: Decodable, Identifiable, Sendable {
  public let id: String
  public let text: String
}

public struct Transfer: Decodable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let size: Int
  public let offset: Int
  public let status: String
  public let sha256: String
}

public struct Workspace: Decodable, Sendable {
  public struct Space: Decodable, Sendable { public let name: String }
  public let me: Device
  public let space: Space
  public let devices: [Device]
  public let clips: [Clip]
  public let transfers: [Transfer]
}

public struct APIError: LocalizedError, Sendable {
  public let message: String
  public let status: Int?
  public init(_ message: String, status: Int? = nil) {
    self.message = message
    self.status = status
  }
  public var errorDescription: String? { message }
}

public struct TransferProgress: Sendable {
  public let phase: String
  public let completed: Int
  public let total: Int
  public var fraction: Double { total == 0 ? 1 : min(1, Double(completed) / Double(total)) }
}

public enum ServerOrigin {
  public static func parse(_ value: String) throws -> URL {
    guard var parts = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
      let host = parts.host, !host.isEmpty,
      parts.user == nil, parts.password == nil,
      parts.query == nil, parts.fragment == nil,
      parts.path.isEmpty || parts.path == "/",
      parts.port == nil || (1...65535).contains(parts.port!),
      parts.scheme?.lowercased() == "https"
        || (parts.scheme?.lowercased() == "http"
          && ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host.lowercased()))
    else { throw APIError("Enter an HTTPS workspace origin, or HTTP on localhost only.") }
    parts.scheme = parts.scheme?.lowercased()
    parts.host = host.lowercased()
    if (parts.scheme == "https" && parts.port == 443)
      || (parts.scheme == "http" && parts.port == 80)
    {
      parts.port = nil
    }
    parts.path = ""
    guard let url = parts.url else { throw APIError("The workspace address is invalid.") }
    return url
  }
}
