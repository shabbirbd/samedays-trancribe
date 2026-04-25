require('dotenv').config();
const express = require('express');
const { exec } = require('child_process');
const mongoose = require('mongoose');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const s3Client = new S3Client({ region: process.env.AWS_REGION });

mongoose.connect(process.env.MONGO_URL)
    .then(() => console.log("Connected to Samedays MongoDB"))
    .catch(err => console.error("MongoDB Connection Error:", err));

const jobQueue = [];
let activeWorkers = 0;
const MAX_WORKERS = 1; 

async function processQueue() {
    if (jobQueue.length === 0 || activeWorkers >= MAX_WORKERS) return;

    activeWorkers++;
    const { userId, fileName } = jobQueue.shift();
    const localFilePath = path.join(__dirname, fileName);

    console.log(`[Queue] Processing: ${fileName}`);

    try {
        const command = new GetObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: `uploads/${fileName}`
        });

        const response = await s3Client.send(command);
        const writer = fs.createWriteStream(localFilePath);
        response.Body.pipe(writer);

        writer.on('finish', () => {
            exec(`python3 transcribe.py ${localFilePath}`, async (error, stdout) => {
                await mongoose.connection.collection('transcripts').updateOne(
                    { fileName: fileName },
                    { $set: { text: stdout, userId: userId, status: 'completed', createdAt: new Date() } },
                    { upsert: true }
                );
                if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
                activeWorkers--;
                processQueue();
            });
        });
    } catch (err) {
        console.error("Error:", err);
        activeWorkers--;
        processQueue();
    }
}

// 1. URL for iOS to get permission to upload
app.get('/get-upload-url', async (req, res) => {
    const fileName = `recording-${Date.now()}.m4a`;
    const command = new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: `uploads/${fileName}`,
        ContentType: 'audio/m4a'
    });

    try {
        // This is the correct v3 way to sign URLs
        const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        res.json({ uploadUrl, fileName });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. URL for iOS to start transcription
app.post('/transcribe', (req, res) => {
    const { userId, fileName } = req.body;
    jobQueue.push({ userId, fileName });
    res.json({ message: "In queue", position: jobQueue.length });
    processQueue();
});

app.listen(8000, () => console.log(`Samedays Manager LIVE on Port 8000`));