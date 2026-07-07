-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "discount_amount_off" INTEGER,
ADD COLUMN     "discount_coupon_name" TEXT,
ADD COLUMN     "discount_currency" TEXT,
ADD COLUMN     "discount_duration" TEXT,
ADD COLUMN     "discount_ends_at" TIMESTAMP(3),
ADD COLUMN     "discount_percent_off" DOUBLE PRECISION,
ADD COLUMN     "discount_promo_code" TEXT;
