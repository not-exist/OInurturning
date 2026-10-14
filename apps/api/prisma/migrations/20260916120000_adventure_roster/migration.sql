-- 旧历练日志仅保留队长 studentId；新列记录完整三人队伍顺序。
ALTER TABLE `AdventureLog` ADD COLUMN `studentIds` JSON NOT NULL DEFAULT ('[]');
