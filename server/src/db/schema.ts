import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const discordUsers = sqliteTable('discordUsers', {
    createdAt: integer('createdAt').notNull(),
    discordID: text('discordID').notNull().unique(),
    discordRefreshToken: text('discordRefreshToken'),
    id: integer('id').primaryKey({ autoIncrement: true }),
});

export const minecraftUsers = sqliteTable('minecraftUsers', {
    createdAt: integer('createdAt').notNull(),
    id: integer('id').primaryKey({ autoIncrement: true }),
    minecraftUUID: text('minecraftUUID').notNull().unique(),
});

export const verificationFlows = sqliteTable('verificationFlows', {
    createdAt: integer('createdAt').notNull(),
    expiresAt: integer('expiresAt').notNull(),
    id: integer('id').primaryKey({ autoIncrement: true }),
    linkingCode: text('linkingCode').notNull().unique(),
    minecraftUUID: text('minecraftUUID').notNull().unique(),
});

export const connections = sqliteTable('connections', {
    createdAt: integer('createdAt').notNull(),
    discordUserID: integer('discordUserID')
        .notNull()
        .references(() => discordUsers.id)
        .unique(),
    id: integer('id').primaryKey({ autoIncrement: true }),
    minecraftUserID: integer('minecraftUserID')
        .notNull()
        .references(() => minecraftUsers.id)
        .unique(),
});
