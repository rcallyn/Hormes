#!/bin/zsh
set -euo pipefail
repo_dir="${0:A:h:h:h:h}"
cd "$repo_dir"
python3 apps/ios/Scripts/generate-project.py
if [[ "${1:-}" == "--device" ]]; then
  phone_device="${2:?Pass the paired iPhone identifier shown by xcrun devicectl list devices}"
  phone_team="${HORMES_IOS_TEAM:-$(codesign -dv /Applications/Hormes.app 2>&1 | awk -F= '/TeamIdentifier=/{print $2}')}"
  [[ -n "$phone_team" && "$phone_team" != "not set" ]] || { print -u2 'Set HORMES_IOS_TEAM to your Apple development team.'; exit 1; }
  xcodebuild -project apps/ios/HormesPhone.xcodeproj -scheme HormesPhone -destination 'generic/platform=iOS' -configuration Debug -derivedDataPath build/ios-device DEVELOPMENT_TEAM="$phone_team" -allowProvisioningUpdates build
  xcrun devicectl device install app --device "$phone_device" build/ios-device/Build/Products/Debug-iphoneos/HormesPhone.app
  xcrun devicectl device process launch --device "$phone_device" com.hormes.phone
else
  xcodebuild -project apps/ios/HormesPhone.xcodeproj -scheme HormesPhone -sdk iphonesimulator -configuration Debug -derivedDataPath build/ios-simulator CODE_SIGN_IDENTITY=- build
fi
