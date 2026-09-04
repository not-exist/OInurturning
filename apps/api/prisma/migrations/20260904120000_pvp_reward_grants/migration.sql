-- CreateTable
CREATE TABLE `PvpRewardGrant` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tournamentId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `rank` INTEGER NOT NULL,
    `rewards` JSON NOT NULL DEFAULT ('[]'),
    `claimedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PvpRewardGrant_tournamentId_userId_key`(`tournamentId`, `userId`),
    INDEX `PvpRewardGrant_tournamentId_rank_idx`(`tournamentId`, `rank`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PvpRewardGrant` ADD CONSTRAINT `PvpRewardGrant_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `PvpTournament`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PvpRewardGrant` ADD CONSTRAINT `PvpRewardGrant_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
