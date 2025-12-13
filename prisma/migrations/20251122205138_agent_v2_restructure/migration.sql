/*
  Warnings:

  - You are about to drop the column `description` on the `ContainerInstance` table. All the data in the column will be lost.
  - You are about to drop the column `game` on the `ContainerInstance` table. All the data in the column will be lost.
  - You are about to drop the column `ingress` on the `ContainerInstance` table. All the data in the column will be lost.
  - You are about to drop the column `ports` on the `ContainerInstance` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `ContainerInstance` table. All the data in the column will be lost.
  - You are about to drop the column `tags` on the `ContainerInstance` table. All the data in the column will be lost.
  - You are about to drop the column `templateId` on the `ContainerInstance` table. All the data in the column will be lost.
  - You are about to drop the column `variant` on the `ContainerInstance` table. All the data in the column will be lost.
  - You are about to drop the `ContainerTemplate` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `agentState` to the `ContainerInstance` table without a default value. This is not possible if the table is not empty.
  - Added the required column `payload` to the `ContainerInstance` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `ContainerInstance` DROP FOREIGN KEY `ContainerInstance_templateId_fkey`;

-- DropIndex
DROP INDEX `ContainerInstance_templateId_fkey` ON `ContainerInstance`;

-- AlterTable
ALTER TABLE `ContainerInstance` DROP COLUMN `description`,
    DROP COLUMN `game`,
    DROP COLUMN `ingress`,
    DROP COLUMN `ports`,
    DROP COLUMN `status`,
    DROP COLUMN `tags`,
    DROP COLUMN `templateId`,
    DROP COLUMN `variant`,
    ADD COLUMN `agentLastSeen` DATETIME(3) NULL,
    ADD COLUMN `agentState` VARCHAR(191) NOT NULL,
    ADD COLUMN `allocatedPorts` JSON NULL,
    ADD COLUMN `crashCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `lastCrashAt` DATETIME(3) NULL,
    ADD COLUMN `payload` JSON NOT NULL;

-- DropTable
DROP TABLE `ContainerTemplate`;
