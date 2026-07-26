import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

private let helperProtocolVersion = 1

private struct StatusResponse: Encodable {
    let ok = true
    let protocolVersion = helperProtocolVersion
    let helperVersion: String
    let bundleIdentifier: String
    let executablePath: String
    let screenCaptureAuthorized: Bool
    let accessibilityAuthorized: Bool
}

private struct CaptureResponse: Encodable {
    let ok = true
    let protocolVersion = helperProtocolVersion
    let displayId: UInt32
    let width: Int
    let height: Int
    let mimeType = "image/png"
}

private struct PermissionResponse: Encodable {
    let ok = true
    let protocolVersion = helperProtocolVersion
    let screenCaptureAuthorized: Bool
}

private struct ErrorResponse: Encodable {
    let ok = false
    let protocolVersion = helperProtocolVersion
    let error: String
}

private enum HelperError: LocalizedError {
    case invalidArguments(String)
    case screenCapturePermissionRequired
    case displayNotFound(UInt32?)
    case pngEncodingFailed

    var errorDescription: String? {
        switch self {
        case .invalidArguments(let message):
            return message
        case .screenCapturePermissionRequired:
            return "Screen Recording permission is required for DevSpace Device Helper."
        case .displayNotFound(let displayId):
            if let displayId {
                return "Display \(displayId) is not available."
            }
            return "No capturable display is available."
        case .pngEncodingFailed:
            return "Could not encode the screenshot as PNG."
        }
    }
}

@main
private struct DevSpaceDeviceHelper {
    static func main() async {
        do {
            let arguments = Array(CommandLine.arguments.dropFirst())
            guard let command = arguments.first else {
                throw HelperError.invalidArguments(
                    "Expected one of: status, capture, request-screen-capture."
                )
            }

            switch command {
            case "status":
                guard arguments.count == 1 else {
                    throw HelperError.invalidArguments("status does not accept arguments.")
                }
                try emit(status())
            case "capture":
                let options = try parseCaptureArguments(Array(arguments.dropFirst()))
                let result = try await capture(
                    outputPath: options.outputPath,
                    requestedDisplayId: options.displayId
                )
                try emit(result)
            case "request-screen-capture":
                guard arguments.count == 1 else {
                    throw HelperError.invalidArguments(
                        "request-screen-capture does not accept arguments."
                    )
                }
                let authorized =
                    CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess()
                try emit(PermissionResponse(screenCaptureAuthorized: authorized))
            default:
                throw HelperError.invalidArguments("Unknown command: \(command)")
            }
        } catch {
            let message =
                (error as? LocalizedError)?.errorDescription
                ?? error.localizedDescription
            try? emit(ErrorResponse(error: message))
            Foundation.exit(EXIT_FAILURE)
        }
    }

    private static func status() -> StatusResponse {
        let bundle = Bundle.main
        return StatusResponse(
            helperVersion: bundle.object(
                forInfoDictionaryKey: "CFBundleShortVersionString"
            ) as? String ?? "unknown",
            bundleIdentifier: bundle.bundleIdentifier ?? "unknown",
            executablePath: CommandLine.arguments[0],
            screenCaptureAuthorized: CGPreflightScreenCaptureAccess(),
            accessibilityAuthorized: AXIsProcessTrusted()
        )
    }

    private static func capture(
        outputPath: String,
        requestedDisplayId: UInt32?
    ) async throws -> CaptureResponse {
        guard CGPreflightScreenCaptureAccess() else {
            throw HelperError.screenCapturePermissionRequired
        }

        let shareableContent = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: true
        )
        let defaultDisplayId = CGMainDisplayID()
        let display =
            requestedDisplayId.flatMap { requested in
                shareableContent.displays.first { $0.displayID == requested }
            }
            ?? shareableContent.displays.first { $0.displayID == defaultDisplayId }
            ?? shareableContent.displays.first

        guard let display else {
            throw HelperError.displayNotFound(requestedDisplayId)
        }
        if let requestedDisplayId, display.displayID != requestedDisplayId {
            throw HelperError.displayNotFound(requestedDisplayId)
        }

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let configuration = SCStreamConfiguration()
        if let displayMode = CGDisplayCopyDisplayMode(display.displayID) {
            configuration.width = displayMode.pixelWidth
            configuration.height = displayMode.pixelHeight
        } else {
            configuration.width = display.width
            configuration.height = display.height
        }
        configuration.showsCursor = true

        let image = try await SCScreenshotManager.captureImage(
            contentFilter: filter,
            configuration: configuration
        )
        try writePng(image, outputPath: outputPath)

        return CaptureResponse(
            displayId: display.displayID,
            width: image.width,
            height: image.height
        )
    }

    private static func writePng(_ image: CGImage, outputPath: String) throws {
        let outputUrl = URL(fileURLWithPath: outputPath)
        try FileManager.default.createDirectory(
            at: outputUrl.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        guard
            let destination = CGImageDestinationCreateWithURL(
                outputUrl as CFURL,
                UTType.png.identifier as CFString,
                1,
                nil
            )
        else {
            throw HelperError.pngEncodingFailed
        }

        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else {
            throw HelperError.pngEncodingFailed
        }
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: outputPath
        )
    }

    private static func parseCaptureArguments(
        _ arguments: [String]
    ) throws -> (outputPath: String, displayId: UInt32?) {
        var outputPath: String?
        var displayId: UInt32?
        var index = 0

        while index < arguments.count {
            switch arguments[index] {
            case "--output":
                index += 1
                guard index < arguments.count else {
                    throw HelperError.invalidArguments("--output requires a path.")
                }
                outputPath = arguments[index]
            case "--display-id":
                index += 1
                guard
                    index < arguments.count,
                    let parsed = UInt32(arguments[index])
                else {
                    throw HelperError.invalidArguments(
                        "--display-id requires an unsigned integer."
                    )
                }
                displayId = parsed
            default:
                throw HelperError.invalidArguments(
                    "Unknown capture argument: \(arguments[index])"
                )
            }
            index += 1
        }

        guard let outputPath, outputPath.hasPrefix("/") else {
            throw HelperError.invalidArguments(
                "capture requires an absolute --output path."
            )
        }
        return (outputPath, displayId)
    }

    private static func emit<T: Encodable>(_ value: T) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(value)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }
}
