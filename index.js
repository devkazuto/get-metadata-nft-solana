const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Konfigurasi
const SIMPLEHASH_API_KEY = 'YOUR_SIMPLEHASH_API_KEY';
const COLLECTION_ADDRESS = 'COLLECTION_ADDRESS';
const OUTPUT_DIR = './nft_metadata';
const LIMIT = 50;

class SimpleHashNFTFetcher {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseURL = 'https://api.simplehash.com/api/v0/nfts/collection';
        this.axiosInstance = axios.create({
            headers: {
                'X-API-KEY': this.apiKey,
                'accept': 'application/json'
            }
        });
        this.metadataCollection = [];
    }

    async setupDirectories() {
        const dirs = [
            OUTPUT_DIR,
            path.join(OUTPUT_DIR, 'images'),
            path.join(OUTPUT_DIR, 'json'),
            path.join(OUTPUT_DIR, 'json_original')
        ];

        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
    }

    async downloadImage(url, filename) {
        try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            const imagePath = path.join(OUTPUT_DIR, 'images', `${filename}.png`);
            fs.writeFileSync(imagePath, response.data);
            return true;
        } catch (error) {
            console.error(`Error downloading image ${filename}:`, error.message);
            return false;
        }
    }

    async fetchOriginalMetadata(url) {
        try {
            const response = await axios.get(url);
            return response.data;
        } catch (error) {
            console.error(`Error fetching original metadata:`, error.message);
            return null;
        }
    }

    async saveMetadata(metadata, filename) {
        try {
            // Simpan metadata SimpleHash
            const jsonPath = path.join(OUTPUT_DIR, 'json', `${filename}.json`);
            fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2));

            // Ambil dan simpan metadata original jika ada
            if (metadata.extra_metadata?.metadata_original_url) {
                const originalMetadata = await this.fetchOriginalMetadata(metadata.extra_metadata.metadata_original_url);
                if (originalMetadata) {
                    const originalJsonPath = path.join(OUTPUT_DIR, 'json_original', `${filename}.json`);
                    fs.writeFileSync(originalJsonPath, JSON.stringify(originalMetadata, null, 2));
                }
            }

            // Tambahkan ke koleksi metadata
            this.metadataCollection.push({
                name: metadata.name,
                img: metadata.extra_metadata?.image_original_url,
                json: metadata.extra_metadata?.metadata_original_url || null
            });

            return true;
        } catch (error) {
            console.error(`Error saving metadata ${filename}:`, error.message);
            return false;
        }
    }

    saveMetadataCollection() {
        try {
            const metadataPath = path.join(OUTPUT_DIR, 'metadata.json');
            fs.writeFileSync(metadataPath, JSON.stringify(this.metadataCollection, null, 2));
            console.log(`✓ Saved metadata collection to metadata.json`);
        } catch (error) {
            console.error('Error saving metadata collection:', error.message);
        }
    }

    async fetchCollectionNFTs() {
        try {
            await this.setupDirectories();
            let cursor = null;
            let totalProcessed = 0;

            do {
                let url = `${this.baseURL}/${COLLECTION_ADDRESS}?limit=${LIMIT}`;
                if (cursor) {
                    url += `&cursor=${cursor}`;
                }

                console.log('\nFetching URL:', url);

                const response = await this.axiosInstance.get(url);
                
                if (!response.data.nfts || response.data.nfts.length === 0) {
                    console.log('No NFTs found in this page or end of collection reached');
                    break;
                }

                for (const nft of response.data.nfts) {
                    totalProcessed++;
                    console.log(`\nProcessing NFT ${totalProcessed}: ${nft.name}`);

                    const sanitizedName = nft.name.replace(/[^a-zA-Z0-9]/g, '_');
                    await this.saveMetadata(nft, sanitizedName);

                    if (nft.image_url) {
                        await this.downloadImage(nft.image_url, sanitizedName);
                        console.log(`✓ Saved metadata and image for ${nft.name}`);
                    }

                    // Add delay between requests
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                cursor = response.data.next_cursor;
                console.log(`\nProcessed ${totalProcessed} NFTs so far...`);

            } while (cursor);

            // Save final metadata collection
            this.saveMetadataCollection();

            console.log(`\nFinished! Total NFTs processed: ${totalProcessed}`);

        } catch (error) {
            console.error('Error fetching collection:', error.message);
            if (error.response) {
                console.error('API Response:', error.response.data);
            }
        }
    }
}

async function main() {
    if (!SIMPLEHASH_API_KEY || SIMPLEHASH_API_KEY === 'YOUR_SIMPLEHASH_API_KEY') {
        console.error('Please set your SimpleHash API key first!');
        return;
    }

    const fetcher = new SimpleHashNFTFetcher(SIMPLEHASH_API_KEY);
    console.log('\nStarting to download NFT metadata and images...\n');
    await fetcher.fetchCollectionNFTs();
}

main().catch(console.error);