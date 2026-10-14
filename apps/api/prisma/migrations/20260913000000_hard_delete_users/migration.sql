-- 注销语义由「软删」改为「物理删除」（TECH-DESIGN §9.6 / §12 T4）：
-- 账号注销即立刻清除库内数据，username 唯一索引随行释放、可立即被重新注册。
--
-- 顺序很重要：必须先把公告外键改成 SET NULL，再删历史软删账号；
-- 否则第 2 步的 DELETE 会按旧的 CASCADE 规则连带清空「已注销管理员」发过的全站公告。

-- 1) 公告作者改 SET NULL：公告是全站内容而非作者个人数据，原 CASCADE 会在管理员
--    自行注销时连带删除其发布过的全部公告。
ALTER TABLE `AdminAnnouncement` DROP FOREIGN KEY `AdminAnnouncement_authorId_fkey`;
ALTER TABLE `AdminAnnouncement` MODIFY `authorId` INTEGER NULL;
ALTER TABLE `AdminAnnouncement` ADD CONSTRAINT `AdminAnnouncement_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) 清理历史软删账号：这些行此前占着 username 唯一索引，正是「注销后重注册提示
--    用户名已被占用」的直接成因。DELETE 由既有 ON DELETE CASCADE 外键自动级联清空
--    其全部业务数据（Student/UserItem/ProblemLibraryEntry/ReputationLog/RecruitPool/
--    ContestRecord/AdventureLog/StoryProgress/LectureLog/TrainingLog/PvpRegistration/
--    PvpRewardGrant），并将 AdminAuditLog.adminId、PvpTournament.createdBy 与
--    AdminAnnouncement.authorId 置空。
DELETE FROM `users` WHERE `deletedAt` IS NOT NULL;

-- 3) 物理删除后软删标记恒为空，移除该列（鉴权层的 deletedAt 拦截同步下线）。
ALTER TABLE `users` DROP COLUMN `deletedAt`;
