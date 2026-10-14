-- CreateTable
CREATE TABLE `ConfigTalent` (
    `id` VARCHAR(64) NOT NULL,
    `sourceHash` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `deprecated` BOOLEAN NOT NULL DEFAULT false,
    `importedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConfigItem` (
    `id` VARCHAR(64) NOT NULL,
    `sourceHash` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `deprecated` BOOLEAN NOT NULL DEFAULT false,
    `importedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConfigProblem` (
    `id` VARCHAR(64) NOT NULL,
    `sourceHash` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `deprecated` BOOLEAN NOT NULL DEFAULT false,
    `importedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConfigEvent` (
    `id` VARCHAR(64) NOT NULL,
    `sourceHash` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `deprecated` BOOLEAN NOT NULL DEFAULT false,
    `importedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConfigStage` (
    `id` VARCHAR(64) NOT NULL,
    `sourceHash` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `deprecated` BOOLEAN NOT NULL DEFAULT false,
    `importedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConfigEconomy` (
    `id` VARCHAR(64) NOT NULL,
    `sourceHash` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `deprecated` BOOLEAN NOT NULL DEFAULT false,
    `importedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConfigImport` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sourceHash` VARCHAR(64) NOT NULL,
    `manifest` JSON NOT NULL,
    `ok` BOOLEAN NOT NULL,
    `errorCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ConfigImport_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
