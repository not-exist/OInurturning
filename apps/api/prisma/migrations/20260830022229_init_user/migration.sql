-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(32) NOT NULL,
    `passwordHash` VARCHAR(191) NULL,
    `role` ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER',
    `money` INTEGER NOT NULL DEFAULT 0,
    `reputation` INTEGER NOT NULL DEFAULT 0,
    `badges` JSON NOT NULL,
    `tokenVersion` INTEGER NOT NULL DEFAULT 0,
    `bannedAt` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `lastSettledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

