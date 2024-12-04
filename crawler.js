const axios = require('axios');
const db = require('./database');

class VintageCrawler {
    constructor() {
        this.baseUrl = 'https://vintagetalk.co.kr/exec/front/Product/ApiProductMain';
        this.defaultParams = {
            display_group: 2,
            supplier_code: 'S0000000',
            bInitMore: 'F',
            count: 30
        };
        this.logCallback = null;
        this.isStopped = false;
        
        // UI에 표시될 파라미터 설정
        this.parameters = [
            {
                name: 'display_group',
                label: '카테고리',
                type: 'number',
                default: 2,
                min: 1
            },
            {
                name: 'supplier_code',
                label: '공급사 코드',
                type: 'text',
                default: 'S0000000'
            },
            {
                name: 'count',
                label: '페이지당 상품 수',
                type: 'number',
                default: 30,
                min: 1
            },
            {
                name: 'start_page',
                label: '시작 페이지',
                type: 'number',
                default: 1,
                min: 1
            },
            {
                name: 'end_page',
                label: '종료 페이지',
                type: 'number',
                default: 10,
                min: 1
            }
        ];
    }

    setLogCallback(callback) {
        this.logCallback = callback;
    }

    stop() {
        this.isStopped = true;
    }

    reset() {
        this.isStopped = false;
    }

    log(message) {
        if (this.logCallback) {
            this.logCallback(message);
        }
        console.log(message);
    }

    getParameters() {
        return this.parameters;
    }

    async crawlPage(page, params = {}) {
        try {
            this.log(`페이지 ${page} 크롤링 시작`);
            
            const response = await axios.get(this.baseUrl, {
                params: {
                    ...this.defaultParams,
                    ...params,
                    page: page
                },
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            if (response.data && response.data.rtn_data && response.data.rtn_data.data) {
                const products = response.data.rtn_data.data;
                this.log(`${products.length}개의 상품 데이터 발견`);
                
                let savedCount = 0;
                let existingCount = 0;

                for (const product of products) {
                    const result = await db.saveProduct(product);
                    if (result.saved) {
                        savedCount++;
                        this.log(`신규 상품 저장: ${product.product_name_striptag} (${product.product_no})`);
                    } else {
                        existingCount++;
                    }
                }

                this.log(`페이지 ${page} 처리 완료: 신규 ${savedCount}개, 기존 ${existingCount}개`);
                return { totalItems: products.length, newItems: savedCount, existingItems: existingCount };
            }
            return { totalItems: 0, newItems: 0, existingItems: 0 };
        } catch (error) {
            const errorMessage = `페이지 ${page} 크롤링 중 오류 발생: ${error.message}`;
            this.log(errorMessage);
            return { totalItems: 0, newItems: 0, existingItems: 0 };
        }
    }

    async crawlAll(params = {}, startPage = 1, endPage = 10) {
        this.reset();
        let stats = {
            totalItems: 0,
            newItems: 0,
            existingItems: 0
        };

        for (let page = startPage; page <= endPage; page++) {
            if (this.isStopped) {
                this.log("크롤링이 중지되었습니다.");
                break;
            }

            this.log(`페이지 ${page} 크롤링 시작...`);
            const pageStats = await this.crawlPage(page, params);
            
            stats.totalItems += pageStats.totalItems;
            stats.newItems += pageStats.newItems;
            stats.existingItems += pageStats.existingItems;

            this.log(`페이지 ${page} 완료 - 총 ${pageStats.totalItems}개 중 ${pageStats.newItems}개 저장, ${pageStats.existingItems}개 기존 상품`);
        }

        return stats;
    }
}

module.exports = VintageCrawler;
