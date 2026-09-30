-- CreateTable
CREATE TABLE "channel_pending_price" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "priceNet" DECIMAL(12,4) NOT NULL,
    "since" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_pending_price_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_pending_price_tenantId_idx" ON "channel_pending_price"("tenantId");

-- CreateIndex
CREATE INDEX "channel_pending_price_channelId_idx" ON "channel_pending_price"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_pending_price_channelId_externalId_key" ON "channel_pending_price"("channelId", "externalId");

-- AddForeignKey
ALTER TABLE "channel_pending_price" ADD CONSTRAINT "channel_pending_price_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_pending_price" ADD CONSTRAINT "channel_pending_price_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

