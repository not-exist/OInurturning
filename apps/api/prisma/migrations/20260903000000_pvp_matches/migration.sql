-- CreateTable
CREATE TABLE `PvpMatch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tournamentId` INTEGER NOT NULL,
    `round` INTEGER NOT NULL,
    `slot` INTEGER NOT NULL,
    `homeUserId` INTEGER NULL,
    `awayUserId` INTEGER NULL,
    `homeScore` INTEGER NULL,
    `awayScore` INTEGER NULL,
    `winnerUserId` INTEGER NULL,
    `status` ENUM('PENDING', 'DONE', 'BYE') NOT NULL DEFAULT 'PENDING',
    `contestRecordId` VARCHAR(64) NULL,
    `playedAt` DATETIME(3) NULL,

    UNIQUE INDEX `PvpMatch_contestRecordId_key`(`contestRecordId`),
    INDEX `PvpMatch_tournamentId_round_idx`(`tournamentId`, `round`),
    UNIQUE INDEX `PvpMatch_tournamentId_round_slot_key`(`tournamentId`, `round`, `slot`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PvpMatch` ADD CONSTRAINT `PvpMatch_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `PvpTournament`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PvpMatch` ADD CONSTRAINT `PvpMatch_contestRecordId_fkey` FOREIGN KEY (`contestRecordId`) REFERENCES `ContestRecord`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
