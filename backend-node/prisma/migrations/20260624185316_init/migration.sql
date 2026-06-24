-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('ytmusic', 'spotify', 'deezer');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "authJson" TEXT NOT NULL,
    "displayName" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackCache" (
    "uid" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "providerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artists" TEXT NOT NULL,
    "album" TEXT,
    "durationMs" INTEGER NOT NULL,
    "isrc" TEXT,
    "thumbnail" TEXT,
    "json" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackCache_pkey" PRIMARY KEY ("uid")
);

-- CreateTable
CREATE TABLE "PlaylistCache" (
    "uid" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "providerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "trackCount" INTEGER NOT NULL,
    "thumbnail" TEXT,
    "tracksJson" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaylistCache_pkey" PRIMARY KEY ("uid")
);

-- CreateTable
CREATE TABLE "MatchCache" (
    "sourceUid" TEXT NOT NULL,
    "isrc" TEXT,
    "ytVideoId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchCache_pkey" PRIMARY KEY ("sourceUid")
);

-- CreateTable
CREATE TABLE "PlayStat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "count" INTEGER NOT NULL DEFAULT 0,
    "lastPlayed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPlaylist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPlaylist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPlaylistTrack" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "UserPlaylistTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderAccount_userId_provider_key" ON "ProviderAccount"("userId", "provider");

-- CreateIndex
CREATE INDEX "TrackCache_isrc_idx" ON "TrackCache"("isrc");

-- CreateIndex
CREATE UNIQUE INDEX "PlayStat_userId_uid_key" ON "PlayStat"("userId", "uid");

-- CreateIndex
CREATE INDEX "UserPlaylistTrack_playlistId_idx" ON "UserPlaylistTrack"("playlistId");

-- AddForeignKey
ALTER TABLE "ProviderAccount" ADD CONSTRAINT "ProviderAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayStat" ADD CONSTRAINT "PlayStat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPlaylist" ADD CONSTRAINT "UserPlaylist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPlaylistTrack" ADD CONSTRAINT "UserPlaylistTrack_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "UserPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
