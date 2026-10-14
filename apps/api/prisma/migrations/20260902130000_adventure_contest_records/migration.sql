-- AlterTable
ALTER TABLE `AdventureLog` ADD COLUMN `contestRecordId` VARCHAR(64) NULL;

-- CreateIndex
CREATE INDEX `AdventureLog_contestRecordId_idx` ON `AdventureLog`(`contestRecordId`);

-- AddForeignKey
ALTER TABLE `AdventureLog` ADD CONSTRAINT `AdventureLog_contestRecordId_fkey` FOREIGN KEY (`contestRecordId`) REFERENCES `ContestRecord`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
