-- 讲课成长（issue #56：讲课能够提升学生水平）
-- 讲课结算附带「出题/思维」成长，需逐场留痕：比对基准 R、思维是否不足、实际增量（可为负）。
ALTER TABLE `LectureLog` ADD COLUMN `thinkingReq` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `LectureLog` ADD COLUMN `thinkingDeficit` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `LectureLog` ADD COLUMN `gains` JSON NOT NULL DEFAULT ('[]');
