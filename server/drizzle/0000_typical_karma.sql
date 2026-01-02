CREATE TABLE `connections` (
	`createdAt` integer NOT NULL,
	`discordUserID` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`minecraftUserID` integer NOT NULL,
	FOREIGN KEY (`discordUserID`) REFERENCES `discordUsers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`minecraftUserID`) REFERENCES `minecraftUsers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connections_discordUserID_unique` ON `connections` (`discordUserID`);--> statement-breakpoint
CREATE UNIQUE INDEX `connections_minecraftUserID_unique` ON `connections` (`minecraftUserID`);--> statement-breakpoint
CREATE TABLE `discordUsers` (
	`createdAt` integer NOT NULL,
	`discordID` text NOT NULL,
	`discordRefreshToken` text,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discordUsers_discordID_unique` ON `discordUsers` (`discordID`);--> statement-breakpoint
CREATE TABLE `minecraftUsers` (
	`createdAt` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`minecraftUUID` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `minecraftUsers_minecraftUUID_unique` ON `minecraftUsers` (`minecraftUUID`);--> statement-breakpoint
CREATE TABLE `verificationFlows` (
	`createdAt` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`linkingCode` text NOT NULL,
	`minecraftUUID` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verificationFlows_linkingCode_unique` ON `verificationFlows` (`linkingCode`);--> statement-breakpoint
CREATE UNIQUE INDEX `verificationFlows_minecraftUUID_unique` ON `verificationFlows` (`minecraftUUID`);