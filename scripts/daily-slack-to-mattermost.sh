#!/usr/bin/env bash
set -Eeuo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin"
export TZ="Asia/Seoul"

TEAM="yourssu-archive"
EMAIL_DOMAIN="urssu.com"
BOT_OWNER="ducks"

BASE_DIR="/home/mattermost/slack-backup"
DAILY_DIR="${BASE_DIR}/daily"
STATE_DIR="${BASE_DIR}/state"
STATE_FILE="${STATE_DIR}/last-success-date"

# 기본값: 전날 하루
TARGET_DATE="${1:-$(date -d 'yesterday' +%Y-%m-%d)}"

TIME_FROM="${TARGET_DATE}T00:00:00"
TIME_TO="${TARGET_DATE}T23:59:59"

RUN_DIR="${DAILY_DIR}/${TARGET_DATE}"
TRANSFORMED_DIR="${RUN_DIR}/transformed"

SLACK_ZIP="${RUN_DIR}/slack-export.zip"
BULK_JSON="${TRANSFORMED_DIR}/bulk-export.jsonl"
IMPORT_ZIP="${RUN_DIR}/import-final.zip"
LOG_FILE="${RUN_DIR}/run.log"

mkdir -p "${RUN_DIR}" "${TRANSFORMED_DIR}" "${STATE_DIR}"

exec > >(tee -a "${LOG_FILE}") 2>&1

echo "========================================"
echo "Slack → Mattermost daily backup"
echo "target_date=${TARGET_DATE}"
echo "time_from=${TIME_FROM}"
echo "time_to=${TIME_TO}"
echo "========================================"

# 동일 날짜의 성공 작업은 중복 실행하지 않음
if [[ -f "${STATE_FILE}" ]] &&
   [[ "$(cat "${STATE_FILE}")" == "${TARGET_DATE}" ]]; then
  echo "Already completed: ${TARGET_DATE}"
  exit 0
fi

echo "[1] Mattermost 상태 확인"

mmctl --local system status

echo "[2] Slack 일일 export"

rm -f "${SLACK_ZIP}"

slackdump export \
  -type mattermost \
  -files=true \
  -time-from "${TIME_FROM}" \
  -time-to "${TIME_TO}" \
  -o "${SLACK_ZIP}"

test -s "${SLACK_ZIP}"

echo "[3] Mattermost bulk 형식으로 변환"

rm -rf "${TRANSFORMED_DIR}"
mkdir -p "${TRANSFORMED_DIR}"

mmetl transform slack \
  --file "${SLACK_ZIP}" \
  --output "${BULK_JSON}" \
  --team "${TEAM}" \
  --default-email-domain "${EMAIL_DOMAIN}" \
  --bot-owner "${BOT_OWNER}" \
  --discard-invalid-props

test -s "${BULK_JSON}"

cd "${TRANSFORMED_DIR}"

echo "[4] team 레코드 추가"

if ! grep -q '"type":"team"' "${BULK_JSON}"; then
  cp "${BULK_JSON}" bulk-export.before-team.jsonl

  (
    head -n 1 bulk-export.before-team.jsonl
    echo "{\"type\":\"team\",\"team\":{\"name\":\"${TEAM}\",\"display_name\":\"${TEAM}\",\"type\":\"O\"}}"
    tail -n +2 bulk-export.before-team.jsonl
  ) > "${BULK_JSON}"
fi

echo "[5] bot / reaction / emoji 안전 정리"

cp "${BULK_JSON}" bulk-export.before-cleanup.jsonl

python3 <<'PY'
import json
from pathlib import Path

path = Path("bulk-export.jsonl")
output_path = Path("bulk-export.cleaned.jsonl")


def remove_reactions(obj):
    if isinstance(obj, dict):
        obj.pop("reactions", None)

        for value in obj.values():
            remove_reactions(value)

    elif isinstance(obj, list):
        for item in obj:
            remove_reactions(item)


output = []

for line in path.read_text().splitlines():
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        continue

    record_type = obj.get("type")

    if record_type in {"bot", "reaction", "emoji"}:
        continue

    if record_type == "post":
        remove_reactions(obj)

    output.append(
        json.dumps(
            obj,
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )

output_path.write_text("\n".join(output) + "\n")
PY

mv bulk-export.cleaned.jsonl "${BULK_JSON}"

echo "[6] 기존 user 레코드 제외"

# 반복 import 시 기존 사용자 비밀번호와 권한이 변경되는 것을 방지한다.
python3 <<'PY'
import json
from pathlib import Path

path = Path("bulk-export.jsonl")
output_path = Path("bulk-export.no-existing-users.jsonl")

output = []

for line in path.read_text().splitlines():
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        continue

    if obj.get("type") == "user":
        continue

    output.append(
        json.dumps(
            obj,
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )

output_path.write_text("\n".join(output) + "\n")
PY

mv bulk-export.no-existing-users.jsonl "${BULK_JSON}"

echo "[7] 기본 검증"

VERSION_COUNT="$(grep -c '"type":"version"' "${BULK_JSON}" || true)"
TEAM_COUNT="$(grep -c '"type":"team"' "${BULK_JSON}" || true)"
POST_COUNT="$(grep -c '"type":"post"' "${BULK_JSON}" || true)"
USER_COUNT="$(grep -c '"type":"user"' "${BULK_JSON}" || true)"
EMOJI_COUNT="$(grep -c '"emoji_name":"' "${BULK_JSON}" || true)"

echo "version=${VERSION_COUNT}"
echo "team=${TEAM_COUNT}"
echo "post=${POST_COUNT}"
echo "user=${USER_COUNT}"
echo "emoji_name=${EMOJI_COUNT}"

if [[ "${VERSION_COUNT}" -ne 1 ]]; then
  echo "Invalid version record"
  exit 1
fi

if [[ "${TEAM_COUNT}" -lt 1 ]]; then
  echo "Team record not found"
  exit 1
fi

if [[ "${EMOJI_COUNT}" -ne 0 ]]; then
  echo "emoji_name remains"
  exit 1
fi

if [[ "${POST_COUNT}" -eq 0 ]]; then
  echo "No posts for ${TARGET_DATE}"
  echo "${TARGET_DATE}" > "${STATE_FILE}"
  exit 0
fi

echo "[8] import zip 생성"

rm -f "${IMPORT_ZIP}"

cd "${TRANSFORMED_DIR}"
zip -q "${IMPORT_ZIP}" bulk-export.jsonl

cd "${RUN_DIR}"

if [[ -d "${RUN_DIR}/data" ]]; then
  zip -qr "${IMPORT_ZIP}" data
fi

test -s "${IMPORT_ZIP}"

echo "[9] zip 구조 확인"

unzip -l "${IMPORT_ZIP}" | head -n 20

echo "[10] Mattermost import 실행"

IMPORT_OUTPUT="$(
  mmctl --local import process \
    --bypass-upload \
    "${IMPORT_ZIP}"
)"

echo "${IMPORT_OUTPUT}"

JOB_ID="$(
  echo "${IMPORT_OUTPUT}" |
    sed -n 's/.*ID: \([a-zA-Z0-9]*\).*/\1/p'
)"

if [[ -z "${JOB_ID}" ]]; then
  echo "Failed to parse import job ID"
  exit 1
fi

echo "job_id=${JOB_ID}"

echo "[11] import 완료 대기"

for _ in $(seq 1 120); do
  JOB_OUTPUT="$(mmctl --local import job show "${JOB_ID}")"

  STATUS="$(
    echo "${JOB_OUTPUT}" |
      sed -n 's/^[[:space:]]*Status:[[:space:]]*//p'
  )"

  echo "status=${STATUS}"

  case "${STATUS}" in
    success)
      echo "${TARGET_DATE}" > "${STATE_FILE}"
      echo "Import completed: ${TARGET_DATE}"
      exit 0
      ;;

    error)
      echo "${JOB_OUTPUT}"
      echo "Import failed"
      exit 1
      ;;

    in_progress | pending)
      sleep 30
      ;;

    *)
      sleep 30
      ;;
  esac
done

echo "Import status timeout"
exit 1