import OmniMacSupport
import XCTest

final class VaultTests: XCTestCase {
  func testKeychainSaveUpdateReadAndRemove() throws {
    let account = "https://omnisync-test-\(UUID().uuidString.lowercased()).invalid"
    defer { try? Vault.remove(account) }
    XCTAssertNil(try Vault.read(account))
    try Vault.save("first-test-token", server: account)
    XCTAssertEqual(try Vault.read(account), "first-test-token")
    try Vault.save("rotated-test-token", server: account)
    XCTAssertEqual(try Vault.read(account), "rotated-test-token")
    try Vault.remove(account)
    XCTAssertNil(try Vault.read(account))
    try Vault.remove(account)
  }
}
