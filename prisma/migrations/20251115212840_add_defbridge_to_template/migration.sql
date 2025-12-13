/*
  Warnings:

  - You are about to drop the column `bridge` on the `ContainerInstance` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `ContainerInstance` table. All the data in the column will be lost.
  - You are about to drop the column `files` on the `ContainerTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `network` on the `ContainerTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `startup` on the `ContainerTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `storage` on the `ContainerTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `tags` on the `ContainerTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `data` on the `DeletedInstance` table. All the data in the column will be lost.
  - You are about to drop the column `dnsState` on the `EdgeState` table. All the data in the column will be lost.
  - You are about to drop the column `lastSync` on the `EdgeState` table. All the data in the column will be lost.
  - You are about to drop the column `proxyState` on the `EdgeState` table. All the data in the column will be lost.
  - You are about to drop the column `velocity` on the `EdgeState` table. All the data in the column will be lost.
  - You are about to drop the column `hostname` on the `JobLog` table. All the data in the column will be lost.
  - You are about to drop the column `payload` on the `JobLog` table. All the data in the column will be lost.
  - You are about to drop the column `result` on the `JobLog` table. All the data in the column will be lost.
  - The primary key for the `PortPool` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `protocol` on the `PortPool` table. All the data in the column will be lost.
  - You are about to drop the column `vmid` on the `PortPool` table. All the data in the column will be lost.
  - You are about to alter the column `status` on the `PortPool` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Enum(EnumId(2))`.
  - You are about to alter the column `portType` on the `PortPool` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(1))` to `VarChar(191)`.
  - You are about to drop the column `updatedAt` on the `SystemConfig` table. All the data in the column will be lost.
  - You are about to alter the column `value` on the `SystemConfig` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Json`.
  - You are about to drop the `HostSlot` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[game,variant,ctype]` on the table `ContainerTemplate` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[port]` on the table `PortPool` will be added. If there are existing duplicate values, this will fail.
  - Made the column `hostname` on table `ContainerInstance` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `defBridge` to the `ContainerTemplate` table without a default value. This is not possible if the table is not empty.
  - Made the column `game` on table `ContainerTemplate` required. This step will fail if there are existing NULL values in that column.
  - Made the column `variant` on table `ContainerTemplate` required. This step will fail if there are existing NULL values in that column.
  - Made the column `hostname` on table `DeletedInstance` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `updatedAt` to the `EdgeState` table without a default value. This is not possible if the table is not empty.
  - Made the column `vmid` on table `EdgeState` required. This step will fail if there are existing NULL values in that column.
  - Made the column `hostname` on table `EdgeState` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `state` to the `JobLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `id` to the `PortPool` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX `ContainerInstance_ctype_status_idx` ON `ContainerInstance`;

-- DropIndex
DROP INDEX `ContainerInstance_hostname_key` ON `ContainerInstance`;

-- AlterTable
ALTER TABLE `ContainerInstance` DROP COLUMN `bridge`,
    DROP COLUMN `name`,
    ADD COLUMN `customerId` VARCHAR(191) NULL,
    MODIFY `hostname` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `ContainerTemplate` DROP COLUMN `files`,
    DROP COLUMN `network`,
    DROP COLUMN `startup`,
    DROP COLUMN `storage`,
    DROP COLUMN `tags`,
    ADD COLUMN `defBridge` VARCHAR(191) NOT NULL,
    MODIFY `game` VARCHAR(191) NOT NULL,
    MODIFY `variant` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `DeletedInstance` DROP COLUMN `data`,
    ADD COLUMN `customerId` VARCHAR(191) NULL,
    ADD COLUMN `game` VARCHAR(191) NULL,
    ADD COLUMN `ip` VARCHAR(191) NULL,
    ADD COLUMN `notes` VARCHAR(191) NULL,
    ADD COLUMN `ports` JSON NULL,
    ADD COLUMN `reason` VARCHAR(191) NULL,
    ADD COLUMN `variant` VARCHAR(191) NULL,
    MODIFY `hostname` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `EdgeState` DROP COLUMN `dnsState`,
    DROP COLUMN `lastSync`,
    DROP COLUMN `proxyState`,
    DROP COLUMN `velocity`,
    ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `edgeIp` VARCHAR(191) NULL,
    ADD COLUMN `ip` VARCHAR(191) NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL,
    MODIFY `vmid` INTEGER NOT NULL,
    MODIFY `hostname` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `JobLog` DROP COLUMN `hostname`,
    DROP COLUMN `payload`,
    DROP COLUMN `result`,
    ADD COLUMN `message` VARCHAR(191) NULL,
    ADD COLUMN `state` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `PortPool` DROP PRIMARY KEY,
    DROP COLUMN `protocol`,
    DROP COLUMN `vmid`,
    ADD COLUMN `allocatedTo` INTEGER NULL,
    ADD COLUMN `id` INTEGER NOT NULL AUTO_INCREMENT,
    MODIFY `status` ENUM('free', 'allocated') NOT NULL DEFAULT 'free',
    MODIFY `portType` VARCHAR(191) NOT NULL,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `SystemConfig` DROP COLUMN `updatedAt`,
    MODIFY `value` JSON NULL;

-- DropTable
DROP TABLE `HostSlot`;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `action` VARCHAR(191) NOT NULL,
    `actor` VARCHAR(191) NULL,
    `payload` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Customer` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `name` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `ContainerInstance_hostname_idx` ON `ContainerInstance`(`hostname`);

-- CreateIndex
CREATE INDEX `ContainerInstance_customerId_idx` ON `ContainerInstance`(`customerId`);

-- CreateIndex
CREATE UNIQUE INDEX `ContainerTemplate_game_variant_ctype_key` ON `ContainerTemplate`(`game`, `variant`, `ctype`);

-- CreateIndex
CREATE UNIQUE INDEX `PortPool_port_key` ON `PortPool`(`port`);
