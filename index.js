const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Konfigurasi
const HELIUS_API_KEY = 'HELIUS-API-KEY'; // Ganti dengan API key Helius Anda
const COLLECTION_ADDRESS = 'BjsebLP2PcKEtswayv23uPqaMkHCxQVWDG9jC9Jg6xAS'; // Ganti dengan alamat collection
const OUTPUT_DIR = './nft_metadata';
const HELIUS_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const DELAY_MS = 500; // Delay antar request untuk menghindari rate limiting
const BATCH_SIZE = 100; // Jumlah NFT per request batch

class HeliusNFTCollectionFetcher {
    constructor() {
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
            // Periksa jika URL dimulai dengan 'ipfs://'
            if (url.startsWith('ipfs://')) {
                // Konversi URL IPFS ke HTTP gateway
                url = url.replace('ipfs://', 'https://ipfs.io/ipfs/');
            }
            
            // Periksa jika URL dimulai dengan 'ar://'
            if (url.startsWith('ar://')) {
                // Konversi URL Arweave ke HTTP gateway
                url = url.replace('ar://', 'https://arweave.net/');
            }

            console.log(`Downloading image from: ${url}`);
            const response = await axios.get(url, { 
                responseType: 'arraybuffer',
                timeout: 10000 // 10 detik timeout
            });
            
            const imagePath = path.join(OUTPUT_DIR, 'images', `${filename}.png`);
            fs.writeFileSync(imagePath, response.data);
            return true;
        } catch (error) {
            console.error(`Error downloading image ${filename}:`, error.message);
            return false;
        }
    }

    async getCollectionAssets() {
        try {
            console.log(`Mengambil asset dari collection: ${COLLECTION_ADDRESS}`);
            
            let allNFTs = [];
            let page = 1;
            let hasMore = true;
            
            while (hasMore) {
                console.log(`Mengambil halaman ${page}...`);
                
                const payload = {
                    jsonrpc: '2.0',
                    id: 'helius-test',
                    method: 'getAssetsByGroup',
                    params: {
                        groupKey: 'collection',
                        groupValue: COLLECTION_ADDRESS,
                        page: page,
                        limit: BATCH_SIZE
                    }
                };
                
                const response = await axios.post(HELIUS_ENDPOINT, payload);
                
                if (response.data.result && response.data.result.items) {
                    const items = response.data.result.items;
                    allNFTs = [...allNFTs, ...items];
                    
                    console.log(`Ditemukan ${items.length} NFT di halaman ${page}`);
                    
                    // Periksa apakah masih ada halaman berikutnya
                    hasMore = items.length === BATCH_SIZE;
                    page++;
                } else {
                    hasMore = false;
                }
                
                // Delay antar request
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
            
            console.log(`Total ditemukan ${allNFTs.length} NFT dalam collection`);
            return allNFTs;
        } catch (error) {
            console.error('Error getting collection assets:', error);
            if (error.response) {
                console.error('API Response:', error.response.data);
            }
            return [];
        }
    }

    async saveMetadata(nft, filename) {
        try {
            // Sanitasi data untuk disimpan
            const onchainMetadata = {
                name: nft.content?.metadata?.name || nft.name || 'Unknown',
                symbol: nft.content?.metadata?.symbol || '',
                mint: nft.id,
                tokenAddress: nft.id,
                collection: nft.grouping.find(g => g.group_key === 'collection')?.group_value || COLLECTION_ADDRESS,
                uri: nft.content?.json_uri || '',
                creators: nft.creators || [],
                royalty: nft.royalty?.basis_points ? nft.royalty.basis_points / 100 : 0,
                attributes: nft.content?.metadata?.attributes || []
            };
            
            // Simpan metadata dari Helius
            const jsonPath = path.join(OUTPUT_DIR, 'json', `${filename}.json`);
            fs.writeFileSync(jsonPath, JSON.stringify(nft, null, 2));
            
            // Simpan metadata dari URI JSON jika tersedia
            let offchainMetadata = null;
            if (nft.content?.json_uri) {
                try {
                    console.log(`Mengambil metadata off-chain dari: ${nft.content.json_uri}`);
                    const response = await axios.get(nft.content.json_uri);
                    offchainMetadata = response.data;
                    
                    const originalJsonPath = path.join(OUTPUT_DIR, 'json_original', `${filename}.json`);
                    fs.writeFileSync(originalJsonPath, JSON.stringify(offchainMetadata, null, 2));
                } catch (error) {
                    console.error(`Error mengambil metadata off-chain:`, error.message);
                }
            }
            
            // Tambahkan ke koleksi metadata
            this.metadataCollection.push({
                name: onchainMetadata.name,
                img: nft.content?.files?.[0]?.uri || nft.content?.metadata?.image || null,
                json: nft.content?.json_uri || null,
                mint: nft.id
            });
            
            return { onchainMetadata, offchainMetadata };
        } catch (error) {
            console.error(`Error saving metadata ${filename}:`, error.message);
            return { onchainMetadata: null, offchainMetadata: null };
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

    async fetchAndProcessNFTs() {
        try {
            await this.setupDirectories();
            
            // Ambil semua NFT dari collection menggunakan Helius API
            const nfts = await this.getCollectionAssets();
            
            if (nfts.length === 0) {
                console.log('Tidak ditemukan NFT untuk collection ini');
                return;
            }
            
            let totalProcessed = 0;
            
            for (const nft of nfts) {
                totalProcessed++;
                const nftName = nft.content?.metadata?.name || `NFT_${totalProcessed}`;
                console.log(`\nProcessing NFT ${totalProcessed}/${nfts.length}: ${nftName}`);
                
                // Sanitasi nama file
                const sanitizedName = nftName.replace(/[^a-zA-Z0-9]/g, '_');
                
                // Simpan metadata
                const { onchainMetadata, offchainMetadata } = await this.saveMetadata(nft, sanitizedName);
                
                // Cari URL gambar
                const imageUrl = nft.content?.files?.[0]?.uri || 
                                nft.content?.metadata?.image || 
                                offchainMetadata?.image || 
                                null;
                
                // Download gambar jika ada
                if (imageUrl) {
                    console.log(`Mengunduh gambar dari: ${imageUrl}`);
                    await this.downloadImage(imageUrl, sanitizedName);
                    console.log(`✓ Saved metadata and image for ${nftName}`);
                } else {
                    console.log(`✓ Saved metadata for ${nftName} (no image found)`);
                }
                
                // Add delay between requests untuk membatasi rate
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
            
            // Simpan metadata koleksi keseluruhan
            this.saveMetadataCollection();
            
            console.log(`\nFinished! Total NFTs processed: ${totalProcessed}`);
            
        } catch (error) {
            console.error('Error:', error);
            if (error.response) {
                console.error('API Response:', error.response.data);
                console.error('Status Code:', error.response.status);
            }
        }
    }
}

async function main() {
    try {
        if (!HELIUS_API_KEY || HELIUS_API_KEY === 'YOUR_HELIUS_API_KEY') {
            console.error('Please set your Helius API key first!');
            return;
        }
        
        const fetcher = new HeliusNFTCollectionFetcher();
        console.log('\nStarting to download NFT metadata and images using Helius API...\n');
        await fetcher.fetchAndProcessNFTs();
    } catch (error) {
        console.error('Error in main process:', error);
    }
}

main();