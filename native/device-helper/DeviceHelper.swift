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

private struct Invocation {
    let responsePath: String?
    let arguments: [String]
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
        let rawArguments = Array(CommandLine.arguments.dropFirst()).filter {
            !$0.hasPrefix("-psn_")
        }
        let fallbackResponsePath = bestEffortResponsePath(rawArguments)

        do {
            let invocation = try parseInvocation(rawArguments)
            let arguments = invocation.arguments
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
                try emit(status(), responsePath: invocation.responsePath)
            case "capture":
                let options = try parseCaptureArguments(Array(arguments.dropFirst()))
                let result = try await capture(
                    outputPath: options.outputPath,
                    requestedDisplayId: options.displayId
                )
                try emit(result, responsePath: invocation.responsePath)
            case "request-screen-capture":
                guard arguments.count == 1 else {
                    throw HelperError.invalidArguments(
                        "request-screen-capture does not accept arguments."
                    )
                }
                let authorized =
                    CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess()
                try emit(
                    PermissionResponse(screenCaptureAuthorized: authorized),
                    responsePath: invocation.responsePath
                )
            default:
                throw HelperError.invalidArguments("Unknown command: \(command)")
            }
        } catch {
            let message =
                (error as? LocalizedError)?.errorDescription
                ?? error.localizedDescription
            try? emit(
                ErrorResponse(error: message),
                responsePath: fallbackResponsePath
            )
            Foundation.exit(EXIT_FAILURE)
        }
    }

    private static func parseInvocation(_ arguments: [String]) throws -> Invocation {
        var responsePath: String?
        var commandArguments: [String] = []
        var index = 0

        while index < arguments.count {
            if arguments[index] == "--response" {
                index += 1
                guard index < arguments.count else {
                    throw HelperError.invalidArguments("--response requires a path.")
                }
                guard responsePath == nil else {
                    throw HelperError.invalidArguments("--response may be provided only once.")
                }
                let candidate = arguments[index]
                guard candidate.hasPrefix("/") else {
                    throw HelperError.invalidArguments(
                        "--response requires an absolute path."
                    )
                }
                responsePath = candidate
            } else {
                commandArguments.append(arguments[index])
            }
            index += 1
        }

        return Invocation(
            responsePath: responsePath,
            arguments: commandArguments
        )
    }

    private static func bestEffortResponsePath(_ arguments: [String]) -> String? {
        guard
            let index = arguments.firstIndex(of: "--response"),
            arguments.indices.contains(index + 1)
        else {
            return nil
        }
        let candidate = arguments[index + 1]
        return candidate.hasPrefix("/") ? candidate : nil
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

    private static func emit<T: Encodable>(
        _ value: T,
        responsePath: String? = nil
    ) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        var data = try encoder.encode(value)
        data.append(0x0A)

        guard let responsePath else {
            FileHandle.standardOutput.write(data)
            return
        }

        let responseUrl = URL(fileURLWithPath: responsePath)
        try FileManager.default.createDirectory(
            at: responseUrl.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try data.write(to: responseUrl, options: .atomic)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: responsePath
        )
    }
}
