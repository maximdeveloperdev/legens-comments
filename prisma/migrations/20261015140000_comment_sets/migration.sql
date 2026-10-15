CREATE TABLE "CommentSet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommentSet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommentSet_userId_name_key" ON "CommentSet"("userId", "name");
ALTER TABLE "CommentSet" ADD CONSTRAINT "CommentSet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
