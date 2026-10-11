import Foundation
import OmniCore
import Security

public enum Vault {
  private static func query(_ server: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "dev.omnisync.device",
      kSecAttrAccount as String: server,
    ]
  }
  public static func read(_ server: String) throws -> String? {
    var q = query(server)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data,
      let token = String(data: data, encoding: .utf8)
    else {
      throw APIError("Unlock your login Keychain, then reconnect. \(message(status))")
    }
    return token
  }
  public static func save(_ token: String, server: String) throws {
    let q = query(server)
    let value = [kSecValueData as String: Data(token.utf8)]
    var status = SecItemUpdate(q as CFDictionary, value as CFDictionary)
    if status == errSecItemNotFound {
      var item = q
      item[kSecValueData as String] = Data(token.utf8)
      item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      status = SecItemAdd(item as CFDictionary, nil)
    }
    guard status == errSecSuccess else {
      throw APIError("Could not save the session to Keychain. \(message(status))")
    }
  }
  public static func remove(_ server: String) throws {
    let status = SecItemDelete(query(server) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw APIError("Could not remove the session from Keychain. \(message(status))")
    }
  }
  private static func message(_ status: OSStatus) -> String {
    SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)."
  }
}
