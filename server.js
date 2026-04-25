require('dotenv').config();
const express = require('express');
const { exec } = require('child_process');
const mongoose = require('mongoose');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// 1. Setup S3 and MongoDB
const s3Client = new S3Client({ region: process.env.AWS_REGION });
mongoose.connect(process.env.MONGO_URL)
    .then(() => console.log("Connected to Samedays MongoDB"))
    .catch(err => console.error("MongoDB Connection Error:", err));

// 2. The Queue System
const jobQueue = [];
let activeWorkers = 0;
const MAX_WORKERS = 1; // Start with 1 for stability on long 2-hour files

async function processQueue() {
    if (jobQueue.length === 0 || activeWorkers >= MAX_WORKERS) return;

    activeWorkers++;
    const { userId, fileName } = jobQueue.shift();
    const localFilePath = path.join(__dirname, fileName);

    console.log(`[Queue] Starting transcription for User: ${userId}, File: ${fileName}`);

    try {
        // 3. Download from S3
        const command = new GetObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: `uploads/${fileName}`
        });

        const response = await s3Client.send(command);
        const writer = fs.createWriteStream(localFilePath);
        
        // Pipe the S3 stream to a local file
        response.Body.pipe(writer);

        writer.on('finish', () => {
            console.log(`[S3] Download complete: ${fileName}. Running AI...`);

            // 4. Run the Python AI Script
            exec(`python3 transcribe.py ${localFilePath}`, async (error, stdout, stderr) => {
                if (error) {
                    console.error(`[AI Error]: ${error}`);
                }

                // 5. Save Result to MongoDB
                await mongoose.connection.collection('transcripts').updateOne(
                    { fileName: fileName },
                    { $set: { text: stdout, userId: userId, status: 'completed', createdAt: new Date() } },
                    { upsert: true }
                );

                // 6. Cleanup local file to save disk space
                if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);

                console.log(`[Queue] Job Finished: ${fileName}`);
                activeWorkers--;
                processQueue(); // Look for next job
            });
        });

    } catch (err) {
        console.error("[S3 Download Error]:", err);
        activeWorkers--;
        processQueue();
    }
}

app.post('/transcribe', (req, res) => {
    const { userId, fileName } = req.body;
    if (!userId || !fileName) return res.status(400).json({ error: "Missing data" });

    jobQueue.push({ userId, fileName });
    res.json({ message: "Added to queue", position: jobQueue.length });
    processQueue();
});

// Add this to server.js
app.get('/get-upload-url', async (req, res) => {
    const fileName = `recording-${Date.now()}.m4a`;
    const params = {
        Bucket: process.env.S3_BUCKET,
        Key: `uploads/${fileName}`,
        Expires: 3600, // URL lasts for 1 hour
        ContentType: 'audio/m4a'
    };

    try {
        const uploadUrl = await s3.getSignedUrlPromise('putObject', params);
        res.json({ uploadUrl, fileName });
    } catch (err) {
        res.status(500).json({ error: "Could not create upload URL" });
    }
});

const PORT = 8000;
app.listen(PORT, () => console.log(`Samedays Manager Running on Port ${PORT}`));