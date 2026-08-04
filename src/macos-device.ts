import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEVICE_HELPER_PROTOCOL_VERSION = 1;
const MAX_HELPER_OUTPUT_BYTES = 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 50 * 1024 * 1024;
const HELPER_TIMEOUT_MS = 30_000;
const APPLICATION_LAUNCHER_PATH = "/usr/bin/open";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface HelperStatusResponse {
  ok: true;
  protocolVersion: number;
  helperVersion: string;
  bundleIdentifier: string;
  executablePath: string;
  screenCaptureAuthorized: boolean;
  accessibilityAuthorized: boolean;
}

interface HelperCaptureResponse {
  ok: true;
  protocolVersion: number;
  displayId: number;
  width: number;
  height: number;
  mimeType: "image/png";
}

interface HelperErrorResponse {
  ok: false;
  protocolVersion?: number;
  error: string;
}

export interface MacOSDeviceStatus {
  platform: NodeJS.Platform;
  supported: boolean;
  helperInstalled: boolean;
  helperPath: string;
  helperVersion?: string;
  bundleIdentifier?: string;
  screenCaptureAuthorized: boolean;
  accessibilityAuthorized: boolean;
  error?: string;
}

export interface ScreenCaptureResult {
  displayId: number;
  width: number;
  height: number;
  mimeType: "image/png";
  data: string;
  bytes: number;
}

export interface MacOSDeviceClientOptions {
  helperPath?: string;
  platform?: NodeJS.Platform;
  temporaryDirectory?: string;
  applicationLauncherPath?: string;
}

export function defaultDeviceHelperPath(): string {
  return join(
    homedir(),
    "Applications",
    "DevSpace Device Helper.app",
    "Contents",
    "MacOS",
    "DevSpace Device Helper",
  );
}

export function deviceHelperApplicationPath(helperPath: string): string | undefined {
  const macOSDirectory = dirname(helperPath);
  const contentsDirectory = dirname(macOSDirectory);
  const applicationPath = dirname(contentsDirectory);

  if (
    basename(macOSDirectory) !== "MacOS" ||
    basename(contentsDirectory) !== "Contents" ||
    !basename(applicationPath).endsWith(".app")
  ) {
    return undefined;
  }
  return applicationPath;
}

export class MacOSDeviceClient {
  private readonly helperPath: string;
  private readonly platform: NodeJS.Platform;
  private readonly temporaryDirectory: string;
  private readonly applicationLauncherPath: string;

  constructor(options: MacOSDeviceClientOptions = {}) {
    this.helperPath = options.helperPath ?? defaultDeviceHelperPath();
    this.platform = options.platform ?? process.platform;
    this.temporaryDirectory = options.temporaryDirectory ?? tmpdir();
    this.applicationLauncherPath =
      options.applicationLauncherPath ?? APPLICATION_LAUNCHER_PATH;
  }

  async status(): Promise<MacOSDeviceStatus> {
    if (this.platform !== "darwin") {
      return {
        platform: this.platform,
        supported: false,
        helperInstalled: false,
        helperPath: this.helperPath,
        screenCaptureAuthorized: false,
        accessibilityAuthorized: false,
        error: "DevSpace Device Helper is supported only on macOS.",
      };
    }

    try {
      await access(this.helperPath, constants.X_OK);
    } catch {
      return {
        platform: this.platform,
        supported: true,
        helperInstalled: false,
        helperPath: this.helperPath,
        screenCaptureAuthorized: false,
        accessibilityAuthorized: false,
        error: `DevSpace Device Helper is not installed at ${this.helperPath}.`,
      };
    }

    try {
      const response = await this.runHelper<HelperStatusResponse>(["status"]);
      assertStatusResponse(response);
      return {
        platform: this.platform,
        supported: true,
        helperInstalled: true,
        helperPath: this.helperPath,
        helperVersion: response.helperVersion,
        bundleIdentifier: response.bundleIdentifier,
        screenCaptureAuthorized: response.screenCaptureAuthorized,
        accessibilityAuthorized: response.accessibilityAuthorized,
      };
    } catch (error) {
      return {
        platform: this.platform,
        supported: true,
        helperInstalled: true,
        helperPath: this.helperPath,
        screenCaptureAuthorized: false,
        accessibilityAuthorized: false,
        error: deviceErrorMessage(error),
      };
    }
  }

  async capture(displayId?: number): Promise<ScreenCaptureResult> {
    if (this.platform !== "darwin") {
      throw new Error("Screen capture is supported only on macOS.");
    }
    if (displayId !== undefined && (!Number.isInteger(displayId) || displayId < 0)) {
      throw new Error("displayId must be a non-negative integer.");
    }

    await access(this.helperPath, constants.X_OK);
    const captureDirectory = await mkdtemp(
      join(this.temporaryDirectory, "devspace-screen-capture-"),
    );
    const outputPath = join(captureDirectory, "screen.png");

    try {
      const args = ["capture", "--output", outputPath];
      if (displayId !== undefined) args.push("--display-id", String(displayId));
      const response = await this.runHelper<HelperCaptureResponse>(args);
      assertCaptureResponse(response);

      const outputStat = await lstat(outputPath);
      if (!outputStat.isFile() || outputStat.isSymbolicLink()) {
        throw new Error("Device Helper did not create a regular screenshot file.");
      }
      if (outputStat.size < PNG_SIGNATURE.length || outputStat.size > MAX_SCREENSHOT_BYTES) {
        throw new Error(
          `Screenshot size ${outputStat.size} is outside the allowed range.`,
        );
      }

      const image = await readFile(outputPath);
      if (!image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
        throw new Error("Device Helper returned a file that is not a PNG image.");
      }

      return {
        displayId: response.displayId,
        width: response.width,
        height: response.height,
        mimeType: response.mimeType,
        data: image.toString("base64"),
        bytes: image.byteLength,
      };
    } finally {
      await rm(captureDirectory, { recursive: true, force: true });
    }
  }

  private async runHelper<T>(args: string[]): Promise<T> {
    const applicationPath = deviceHelperApplicationPath(this.helperPath);
    if (!applicationPath) {
      return this.runHelperDirectly<T>(args);
    }
    return this.runBundledHelper<T>(applicationPath, args);
  }

  private async runBundledHelper<T>(
    applicationPath: string,
    args: string[],
  ): Promise<T> {
    const requestDirectory = await mkdtemp(
      join(this.temporaryDirectory, "devspace-device-helper-request-"),
    );
    const responsePath = join(requestDirectory, "response.json");
    let launchError: unknown;

    try {
      try {
        await execFileAsync(
          this.applicationLauncherPath,
          [
            "-n",
            "-g",
            applicationPath,
            "--args",
            "--response",
            responsePath,
            ...args,
          ],
          {
            encoding: "utf8",
            maxBuffer: MAX_HELPER_OUTPUT_BYTES,
            timeout: HELPER_TIMEOUT_MS,
            windowsHide: true,
          },
        );
      } catch (error) {
        launchError = error;
      }

      let output: string;
      try {
        output = await readHelperResponseFile(responsePath, HELPER_TIMEOUT_MS);
      } catch (responseError) {
        if (launchError) throw launchError;
        throw responseError;
      }
      return parseHelperResponse<T>(output);
    } finally {
      await rm(requestDirectory, { recursive: true, force: true });
    }
  }

  private async runHelperDirectly<T>(args: string[]): Promise<T> {
    try {
      const result = await execFileAsync(this.helperPath, args, {
        encoding: "utf8",
        maxBuffer: MAX_HELPER_OUTPUT_BYTES,
        timeout: HELPER_TIMEOUT_MS,
        windowsHide: true,
      });
      return parseHelperResponse<T>(result.stdout);
    } catch (error) {
      const output =
        typeof error === "object" &&
        error !== null &&
        "stdout" in error &&
        typeof error.stdout === "string"
          ? error.stdout
          : "";
      const helperError = tryParseHelperError(output);
      if (helperError) throw new Error(helperError.error);
      throw error;
    }
  }
}

export function deviceErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function readHelperResponseFile(
  responsePath: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let responseStat;

  while (Date.now() < deadline) {
    try {
      responseStat = await lstat(responsePath);
      break;
    } catch {
      await delay(25);
    }
  }

  if (!responseStat) {
    throw new Error("Device Helper did not create a response file before timeout.");
  }
  if (!responseStat.isFile() || responseStat.isSymbolicLink()) {
    throw new Error("Device Helper response is not a regular file.");
  }
  if (responseStat.size < 2 || responseStat.size > MAX_HELPER_OUTPUT_BYTES) {
    throw new Error(
      `Device Helper response size ${responseStat.size} is outside the allowed range.`,
    );
  }
  return readFile(responsePath, "utf8");
}

function parseHelperResponse<T>(output: string): T {
  const trimmed = output.trim();
  if (!trimmed) throw new Error("Device Helper returned no response.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Device Helper returned invalid JSON.");
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    "ok" in parsed &&
    parsed.ok === false &&
    "error" in parsed &&
    typeof parsed.error === "string"
  ) {
    throw new Error(parsed.error);
  }
  return parsed as T;
}

function tryParseHelperError(output: string): HelperErrorResponse | undefined {
  try {
    const parsed = JSON.parse(output.trim()) as HelperErrorResponse;
    return parsed?.ok === false && typeof parsed.error === "string"
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function assertProtocolVersion(value: number): void {
  if (value !== DEVICE_HELPER_PROTOCOL_VERSION) {
    throw new Error(
      `Unsupported Device Helper protocol version ${String(value)}; expected ${DEVICE_HELPER_PROTOCOL_VERSION}.`,
    );
  }
}

function assertStatusResponse(
  response: HelperStatusResponse,
): asserts response is HelperStatusResponse {
  if (
    !response ||
    response.ok !== true ||
    typeof response.protocolVersion !== "number" ||
    typeof response.helperVersion !== "string" ||
    typeof response.bundleIdentifier !== "string" ||
    typeof response.screenCaptureAuthorized !== "boolean" ||
    typeof response.accessibilityAuthorized !== "boolean"
  ) {
    throw new Error("Device Helper returned an invalid status response.");
  }
  assertProtocolVersion(response.protocolVersion);
}

function assertCaptureResponse(
  response: HelperCaptureResponse,
): asserts response is HelperCaptureResponse {
  if (
    !response ||
    response.ok !== true ||
    typeof response.protocolVersion !== "number" ||
    !Number.isInteger(response.displayId) ||
    !Number.isInteger(response.width) ||
    !Number.isInteger(response.height) ||
    response.width < 1 ||
    response.height < 1 ||
    response.mimeType !== "image/png"
  ) {
    throw new Error("Device Helper returned an invalid capture response.");
  }
  assertProtocolVersion(response.protocolVersion);
}
