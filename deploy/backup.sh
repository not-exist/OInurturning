#!/bin/sh
# =============================================================================
# oinur 每日数据库备份（宿主机 crontab 调用，见 docs/OPERATIONS.md §4 备份与恢复）
#
# 用法：
#   deploy/backup.sh                      # 备份到 BACKUP_DIR（默认 /var/backups/oinur）
#   BACKUP_DIR=/tmp/backups deploy/backup.sh
#   RETENTION_DAYS=30 deploy/backup.sh
#
# 行为：
#   * 通过 `docker exec` 在 oinur-mysql 容器内执行 mysqldump（凭据取自容器环境变量，
#     宿主机不落明文密码）；
#   * --single-transaction + --quick：InnoDB MVCC 一致性快照，不锁业务表；
#   * gzip 落盘，文件名带日期；退出码非 0 时不清理旧档并打印错误；
#   * 默认保留 14 天（RETENTION_DAYS 可调），可另接 rclone/rsync 同步异机。
#
# crontab 示例（每日 04:00 备份，04:30 清理——清理并入本脚本则只需一行）：
#   0 4 * * * /path/to/oinur/deploy/backup.sh >> /var/log/oinur-backup.log 2>&1
# =============================================================================
set -eu

CONTAINER="${OINUR_MYSQL_CONTAINER:-oinur-mysql}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/oinur}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="${BACKUP_DIR}/oinur-${STAMP}.sql.gz"

if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
  echo "[backup] ERROR: container ${CONTAINER} 未在运行" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

# 凭据从容器环境读取：MYSQL_USER/MYSQL_PASSWORD/MYSQL_DATABASE 由 compose 注入
# （docker exec 内 sh 展开 $VAR；宿主机侧不接触密码明文）
if ! docker exec "${CONTAINER}" sh -c \
  'mysqldump -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --single-transaction --quick "$MYSQL_DATABASE"' \
  | gzip > "${OUT_FILE}.tmp"; then
  rm -f "${OUT_FILE}.tmp"
  echo "[backup] ERROR: mysqldump 失败，未生成 ${OUT_FILE}" >&2
  exit 1
fi
mv "${OUT_FILE}.tmp" "${OUT_FILE}"

# 滚动清理（mtime 按天）
find "${BACKUP_DIR}" -maxdepth 1 -name 'oinur-*.sql.gz' -mtime +"${RETENTION_DAYS}" -delete

SIZE="$(du -h "${OUT_FILE}" | cut -f1)"
COUNT="$(find "${BACKUP_DIR}" -maxdepth 1 -name 'oinur-*.sql.gz' | wc -l)"
echo "[backup] OK ${OUT_FILE} (${SIZE})；当前保留 ${COUNT} 份（retention ${RETENTION_DAYS} 天）"
