-- CreateTable
CREATE TABLE `ContainerTemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(191) NOT NULL,
    `game` VARCHAR(191) NULL,
    `variant` VARCHAR(191) NULL,
    `ctype` ENUM('game', 'dev') NOT NULL,
    `templateVmid` INTEGER NOT NULL,
    `resources` JSON NULL,
    `network` JSON NULL,
    `files` JSON NULL,
    `startup` JSON NULL,
    `storage` VARCHAR(191) NULL,
    `tags` VARCHAR(191) NULL,
    `features` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ContainerTemplate_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContainerInstance` (
    `vmid` INTEGER NOT NULL,
    `ctype` ENUM('game', 'dev') NOT NULL,
    `game` VARCHAR(191) NULL,
    `variant` VARCHAR(191) NULL,
    `bridge` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `tags` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `templateId` INTEGER NULL,
    `name` VARCHAR(191) NOT NULL,
    `hostname` VARCHAR(191) NULL,
    `ip` VARCHAR(191) NULL,
    `ingress` JSON NULL,
    `ports` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ContainerInstance_hostname_key`(`hostname`),
    INDEX `ContainerInstance_ctype_status_idx`(`ctype`, `status`),
    PRIMARY KEY (`vmid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PortPool` (
    `port` INTEGER NOT NULL,
    `protocol` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `portType` ENUM('GAME', 'DEV') NOT NULL,
    `vmid` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PortPool_status_portType_idx`(`status`, `portType`),
    PRIMARY KEY (`port`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HostSlot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `label` VARCHAR(191) NOT NULL,
    `slot` INTEGER NOT NULL,
    `hostname` VARCHAR(191) NOT NULL,
    `basePort` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `HostSlot_hostname_key`(`hostname`),
    INDEX `HostSlot_label_status_idx`(`label`, `status`),
    INDEX `HostSlot_slot_idx`(`slot`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeletedInstance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vmid` INTEGER NOT NULL,
    `hostname` VARCHAR(191) NULL,
    `data` JSON NULL,
    `deletedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JobLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `jobType` VARCHAR(191) NOT NULL,
    `vmid` INTEGER NULL,
    `hostname` VARCHAR(191) NULL,
    `payload` JSON NULL,
    `result` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EdgeState` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vmid` INTEGER NULL,
    `hostname` VARCHAR(191) NULL,
    `lastSync` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dnsState` JSON NULL,
    `proxyState` JSON NULL,
    `velocity` JSON NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemConfig` (
    `key` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VmidCounter` (
    `key` VARCHAR(191) NOT NULL,
    `current` INTEGER NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ContainerInstance` ADD CONSTRAINT `ContainerInstance_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `ContainerTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
