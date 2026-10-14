-- CreateTable
CREATE TABLE `ContestRecord` (
    `id` VARCHAR(64) NOT NULL,
    `userId` INTEGER NOT NULL,
    `type` ENUM('STORY', 'PVP', 'ADVENTURE') NOT NULL,
    `format` ENUM('RANKING', 'DUEL') NOT NULL,
    `stageKey` VARCHAR(64) NULL,
    `ngLevel` INTEGER NULL,
    `idempotencyKey` VARCHAR(128) NOT NULL,
    `inputSnapshot` JSON NOT NULL,
    `report` JSON NOT NULL,
    `summary` JSON NOT NULL,
    `rewards` JSON NOT NULL,
    `snapshotHash` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ContestRecord_userId_type_createdAt_idx`(`userId`, `type`, `createdAt`),
    UNIQUE INDEX `ContestRecord_userId_idempotencyKey_key`(`userId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoryProgress` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `ngLevel` INTEGER NOT NULL,
    `stageKey` VARCHAR(64) NOT NULL,
    `firstClearAt` DATETIME(3) NULL,
    `bestRank` INTEGER NULL,
    `clearCount` INTEGER NOT NULL DEFAULT 0,
    `rewards` JSON NOT NULL,
    `growth` JSON NOT NULL,
    `lastRecordId` VARCHAR(64) NULL,
    `lastSummary` JSON NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StoryProgress_userId_ngLevel_idx`(`userId`, `ngLevel`),
    UNIQUE INDEX `StoryProgress_userId_ngLevel_stageKey_key`(`userId`, `ngLevel`, `stageKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ContestRecord` ADD CONSTRAINT `ContestRecord_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoryProgress` ADD CONSTRAINT `StoryProgress_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
