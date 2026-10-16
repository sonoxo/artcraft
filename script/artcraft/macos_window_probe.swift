// Reports only windows belonging to the application process under test.
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 2,
      let processID = Int32(CommandLine.arguments[1]) else {
  FileHandle.standardError.write(Data("Usage: macos-window-probe <pid>\n".utf8))
  exit(2)
}

guard let windows = CGWindowListCopyWindowInfo(
  [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID
) as? [[String: Any]] else {
  FileHandle.standardError.write(Data("The window server did not return a window list.\n".utf8))
  exit(2)
}

let applicationWindows = windows.compactMap { window -> [String: Any]? in
  guard let owner = window[kCGWindowOwnerPID as String] as? NSNumber,
        owner.int32Value == processID,
        let layer = window[kCGWindowLayer as String] as? NSNumber,
        layer.intValue == 0,
        let bounds = window[kCGWindowBounds as String] as? [String: Any],
        let width = bounds["Width"] as? NSNumber,
        let height = bounds["Height"] as? NSNumber,
        width.doubleValue >= 100,
        height.doubleValue >= 100 else { return nil }
  return [
    "id": window[kCGWindowNumber as String] ?? 0,
    "owner_pid": owner,
    "owner_name": window[kCGWindowOwnerName as String] ?? "",
    "title": window[kCGWindowName as String] ?? "",
    "bounds": bounds,
  ]
}

let output = try JSONSerialization.data(
  withJSONObject: ["pid": processID, "windows": applicationWindows],
  options: [.prettyPrinted, .sortedKeys]
)
FileHandle.standardOutput.write(output)
FileHandle.standardOutput.write(Data("\n".utf8))
exit(applicationWindows.isEmpty ? 1 : 0)
