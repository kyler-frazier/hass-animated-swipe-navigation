#!/command/with-contenv bash
# Runs inside the Home Assistant container before it starts (s6-overlay cont-init).
# Prepares a ready-to-use instance: test user, onboarding skipped, plugin resource.
set -eEuo pipefail

username=${HASS_USERNAME:-test}
password=${HASS_PASSWORD:-test}

echo "[animated-swipe-navigation] Preparing test instance ($(hass --version))"
hass --script ensure_config -c /config
mkdir -p /config/.storage

if [ ! -f /config/.storage/onboarding ]; then
  hass --script auth -c /config add "${username}" "${password}"
  cat > /config/.storage/onboarding <<JSON
{ "version": 4, "minor_version": 1, "key": "onboarding",
  "data": { "done": ["user", "core_config", "analytics", "integration"] } }
JSON
fi

# The plugin is mounted into /config/www, so it's served under /local
cat > /config/.storage/lovelace_resources <<JSON
{ "version": 1, "minor_version": 1, "key": "lovelace_resources",
  "data": { "items": [
    { "id": "animated_swipe_navigation", "type": "module",
      "url": "/local/animated-swipe-navigation.js?v=$(date +%s)" }
  ] } }
JSON
