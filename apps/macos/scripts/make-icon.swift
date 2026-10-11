import AppKit
import Foundation

let directory = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
  for scale in [1, 2] {
    let pixels = size * scale
    let bitmap = NSBitmapImageRep(
      bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
      bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
      isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    let transform = NSAffineTransform()
    transform.scale(by: CGFloat(pixels) / 1024)
    transform.concat()
    NSColor(calibratedRed: 0.19, green: 0.36, blue: 0.27, alpha: 1).setFill()
    NSBezierPath(
      roundedRect: NSRect(x: 74, y: 74, width: 876, height: 876), xRadius: 200, yRadius: 200
    ).fill()
    NSColor(calibratedRed: 0.89, green: 0.95, blue: 0.84, alpha: 1).setStroke()
    for rect in [
      NSRect(x: 242, y: 402, width: 340, height: 340),
      NSRect(x: 442, y: 262, width: 340, height: 340),
    ] {
      let path = NSBezierPath(roundedRect: rect, xRadius: 82, yRadius: 82)
      path.lineWidth = 54
      path.stroke()
    }
    NSGraphicsContext.restoreGraphicsState()
    let suffix = scale == 2 ? "@2x" : ""
    try bitmap.representation(using: .png, properties: [:])!.write(
      to: directory.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
  }
}
