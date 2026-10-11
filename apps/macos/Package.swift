// swift-tools-version: 5.9
import PackageDescription

#if os(macOS)
  let cryptoDependencies: [Package.Dependency] = []
  let coreDependencies: [Target.Dependency] = []
  let appProducts: [Product] = [.executable(name: "OmniSync", targets: ["OmniSync"])]
  let appTargets: [Target] = [
    .target(name: "OmniMacSupport", dependencies: ["OmniCore"]),
    .executableTarget(name: "OmniSync", dependencies: ["OmniCore", "OmniMacSupport"]),
    .testTarget(name: "OmniMacSupportTests", dependencies: ["OmniMacSupport"]),
  ]
#else
  // The same transport runs in Linux tests; production macOS uses system CryptoKit.
  let cryptoDependencies: [Package.Dependency] = [
    .package(url: "https://github.com/apple/swift-crypto.git", exact: "3.8.1")
  ]
  let coreDependencies: [Target.Dependency] = [.product(name: "Crypto", package: "swift-crypto")]
  let appProducts: [Product] = []
  let appTargets: [Target] = []
#endif

let package = Package(
  name: "OmniSync",
  platforms: [.macOS(.v13)],
  products: [.library(name: "OmniCore", targets: ["OmniCore"])] + appProducts,
  dependencies: cryptoDependencies,
  targets: [
    .target(name: "OmniCore", dependencies: coreDependencies),
    .testTarget(name: "OmniCoreTests", dependencies: ["OmniCore"]),
  ] + appTargets
)
