#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_root=$(CDPATH= cd -- "${script_dir}/.." && pwd)
source_file="${project_root}/native/device-helper/DeviceHelper.swift"
plist_file="${project_root}/native/device-helper/Info.plist"
icon_source_file="${project_root}/docs/assets/devspace-logo-light.png"
app_name="DevSpace Device Helper.app"
executable_name="DevSpace Device Helper"
icon_name="DevSpace"
install_path="${DEVSPACE_DEVICE_HELPER_INSTALL_PATH:-${HOME}/Applications/${app_name}}"
signing_identity="${DEVSPACE_DEVICE_HELPER_SIGNING_IDENTITY:-}"
request_screen_access=0

if [ "${1:-}" = "--request-screen-access" ]; then
  request_screen_access=1
elif [ "$#" -gt 0 ]; then
  echo "Usage: $0 [--request-screen-access]" >&2
  exit 64
fi

case "${install_path}" in
  */"${app_name}") ;;
  *)
    echo "Install path must end with ${app_name}: ${install_path}" >&2
    exit 64
    ;;
esac

if [ -z "${signing_identity}" ]; then
  signing_identity=$(
    /usr/bin/security find-identity -v -p codesigning |
      /usr/bin/sed -n 's/^[[:space:]]*[0-9][0-9]*) [A-F0-9]* "\(Apple Development:.*\)"/\1/p' |
      /usr/bin/head -n 1
  )
fi

if [ -z "${signing_identity}" ]; then
  echo "No Apple Development signing identity is available." >&2
  echo "Set DEVSPACE_DEVICE_HELPER_SIGNING_IDENTITY to a stable signing identity." >&2
  exit 1
fi

build_root=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/devspace-device-helper.XXXXXX")
built_app="${build_root}/${app_name}"
built_executable="${built_app}/Contents/MacOS/${executable_name}"
built_icon="${built_app}/Contents/Resources/${icon_name}.icns"
iconset_path="${build_root}/${icon_name}.iconset"
install_parent=$(/usr/bin/dirname "${install_path}")
incoming_path="${install_parent}/.${app_name}.incoming.$$"
previous_path="${install_parent}/.${app_name}.previous"
helper_request_dir=""

cleanup() {
  /bin/rm -rf "${build_root}"
  if [ -e "${incoming_path}" ]; then
    /bin/rm -rf "${incoming_path}"
  fi
  if [ -n "${helper_request_dir}" ] && [ -e "${helper_request_dir}" ]; then
    /bin/rm -rf "${helper_request_dir}"
  fi
}
trap cleanup EXIT HUP INT TERM

[ -f "${icon_source_file}" ] || {
  echo "Device Helper icon source is missing: ${icon_source_file}" >&2
  exit 1
}

/bin/mkdir -p "${built_app}/Contents/MacOS" "${built_app}/Contents/Resources" "${iconset_path}"
/usr/bin/ditto "${plist_file}" "${built_app}/Contents/Info.plist"

for icon_spec in \
  "16 icon_16x16.png" \
  "32 icon_16x16@2x.png" \
  "32 icon_32x32.png" \
  "64 icon_32x32@2x.png" \
  "128 icon_128x128.png" \
  "256 icon_128x128@2x.png" \
  "256 icon_256x256.png" \
  "512 icon_256x256@2x.png" \
  "512 icon_512x512.png" \
  "1024 icon_512x512@2x.png"
do
  icon_size=${icon_spec%% *}
  icon_file=${icon_spec#* }
  /usr/bin/sips -z "${icon_size}" "${icon_size}" \
    "${icon_source_file}" --out "${iconset_path}/${icon_file}" >/dev/null
 done
/usr/bin/iconutil -c icns "${iconset_path}" -o "${built_icon}"

architecture=$(/usr/bin/uname -m)
/usr/bin/xcrun swiftc \
  -parse-as-library \
  -O \
  -target "${architecture}-apple-macosx14.0" \
  -framework AppKit \
  -framework ApplicationServices \
  -framework CoreGraphics \
  -framework ImageIO \
  -framework ScreenCaptureKit \
  -framework UniformTypeIdentifiers \
  "${source_file}" \
  -o "${built_executable}"

/usr/bin/codesign \
  --force \
  --options runtime \
  --timestamp=none \
  --sign "${signing_identity}" \
  "${built_app}"
/usr/bin/codesign --verify --deep --strict --verbose=2 "${built_app}"

/bin/mkdir -p "${install_parent}"
if [ -e "${incoming_path}" ]; then
  /bin/rm -rf "${incoming_path}"
fi
/usr/bin/ditto "${built_app}" "${incoming_path}"
/usr/bin/codesign --verify --deep --strict --verbose=2 "${incoming_path}"

if [ -e "${previous_path}" ]; then
  /bin/rm -rf "${previous_path}"
fi
if [ -e "${install_path}" ]; then
  /bin/mv "${install_path}" "${previous_path}"
fi

if ! /bin/mv "${incoming_path}" "${install_path}"; then
  if [ -e "${previous_path}" ]; then
    /bin/mv "${previous_path}" "${install_path}"
  fi
  exit 1
fi

if ! /usr/bin/codesign --verify --deep --strict --verbose=2 "${install_path}"; then
  /bin/rm -rf "${install_path}"
  if [ -e "${previous_path}" ]; then
    /bin/mv "${previous_path}" "${install_path}"
  fi
  exit 1
fi

if [ -e "${previous_path}" ]; then
  /bin/rm -rf "${previous_path}"
fi

run_helper_app() {
  helper_request_dir=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/devspace-device-helper-request.XXXXXX")
  response_path="${helper_request_dir}/response.json"

  if ! /usr/bin/open -n -g "${install_path}" --args \
    --response "${response_path}" "$@"; then
    echo "Could not launch ${app_name} through LaunchServices." >&2
    exit 1
  fi

  attempts=0
  while [ ! -s "${response_path}" ] && [ "${attempts}" -lt 600 ]; do
    /bin/sleep 0.05
    attempts=$((attempts + 1))
  done
  if [ ! -s "${response_path}" ]; then
    echo "${app_name} did not create a response file before timeout." >&2
    exit 1
  fi

  /bin/cat "${response_path}"
  /bin/rm -rf "${helper_request_dir}"
  helper_request_dir=""
}

echo "Installed ${install_path}"
/usr/bin/codesign -dv --verbose=2 "${install_path}" 2>&1 |
  /usr/bin/sed -n '/^Identifier=/p;/^Authority=/p;/^TeamIdentifier=/p'
run_helper_app status

if [ "${request_screen_access}" -eq 1 ]; then
  run_helper_app request-screen-capture
fi
