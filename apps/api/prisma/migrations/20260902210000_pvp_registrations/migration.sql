-- CreateTable
CREATE TABLE `PvpRegistration` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tournamentId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `roster` JSON NOT NULL,
    `problemEntryIds` JSON NOT NULL,
    `problemSnapshots` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PvpRegistration_tournamentId_createdAt_idx`(`tournamentId`, `createdAt`),
    UNIQUE INDEX `PvpRegistration_tournamentId_userId_key`(`tournamentId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PvpRegistration` ADD CONSTRAINT `PvpRegistration_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `PvpTournament`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PvpRegistration` ADD CONSTRAINT `PvpRegistration_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
