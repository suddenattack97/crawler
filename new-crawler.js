const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('./database');

class NewCrawler {
    constructor() {
        this.logCallback = null;
        this.isStopped = false;
        this.baseUrl = 'https://vintagetalk.co.kr/product/list.html';
        this.failedItemsLog = path.join(__dirname, 'failed_items.log');
        this.debugLog = path.join(__dirname, 'debug.log');
        this.currentProductLog = null;

        // UI에 표시될 파라미터 설정
        this.parameters = [
            {
                name: 'display_group',
                label: '카테고리',
                type: 'select',
                options: [
                    { value: '2460', label: '상의' },
                    { value: '2461', label: '하의' },
                    { value: '2462', label: '아우터' },
                    { value: '2463', label: '신발' },
                    { value: '2464', label: '악세사리' }
                ],
                default: '2460'
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

    async writeDebugLog(message, type = 'info') {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] [${type}] ${message}\n`;

        try {
            await fs.appendFile(this.debugLog, logEntry, 'utf8');

            // 현재 상품별 로그 파일이 있다면 그곳에도 기록
            if (this.currentProductLog) {
                await fs.appendFile(this.currentProductLog, logEntry, 'utf8');
            }

            // 콘솔에도 출력
            if (this.logCallback) {
                this.logCallback(message);
            }
        } catch (error) {
            console.error('로그 저장 중 오류:', error);
        }
    }

    async startProductLog(productNo) {
        // 로그 디렉토리 생성
        const logDir = path.join(__dirname, 'logs', 'products');
        try {
            await fs.mkdir(logDir, { recursive: true });
            this.currentProductLog = path.join(logDir, `product_${productNo}_${Date.now()}.log`);
        } catch (error) {
            console.error('로그 디렉토리 생성 중 오류:', error);
        }
    }

    log(message) {
        if (this.logCallback) {
            this.logCallback(message);
        }
    }

    // 파라미터 정보를 반환하는 메소드 추가
    getParameters() {
        return this.parameters;
    }

    async logFailedItem(item, error) {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] Error: ${error}\nDOM:\n${item}\n\n`;
        await fs.appendFile(this.failedItemsLog, logEntry, 'utf8');
        await this.writeDebugLog(`실패한 아이템 로그 저장됨: ${this.failedItemsLog}`, 'error');
    }

    async parseProduct($, element) {
        try {
            const $item = $(element);

            // 앵커 박스에서 상품 번호 추출 시도
            const anchorBox = $item.find('a[name^="anchorBoxName"]');
            const productNo = anchorBox.attr('name')?.replace('anchorBoxName_', '');

            // 상품별 로그 파일 시작
            await this.startProductLog(productNo);

            // 전체 HTML 구조 로깅
            // await this.writeDebugLog('=== DOM 구조 시작 ===');
            // await this.writeDebugLog($item.html());
            // await this.writeDebugLog('=== DOM 구조 끝 ===\n');

            if (!productNo) {
                throw new Error('Product number not found');
            }

            // 상품명 추출 시도 - 수정된 부분
            const nameSpanEl = $item.find('.name a span[style*="font-size:14px"]').last();
            const productName = nameSpanEl.text().trim();
            // await this.writeDebugLog('상품명: ' + productName);

            // 가격 추출 시도 - 수정된 부분
            const descriptionEl = $item.find('.description');
            const price = parseInt(descriptionEl.attr('ec-data-price')) || 0;
            // await this.writeDebugLog('가격: ' + price);

            // 브랜드명 추출 시도 - 수정된 부분
            const brandSpanEl = $item.find('strong.title:contains("브랜드") + span');
            const brand = brandSpanEl.text().trim();
            // await this.writeDebugLog('브랜드: ' + brand);

            // 할인가격 추출 시도
            const salePriceEl = $item.find('li:contains("할인판매가") span');
            const salePriceListEl = $item.find('.price_list span');
            const salePriceText = salePriceEl.text().trim() || salePriceListEl.text().trim();
            const salePrice = parseInt(salePriceText.replace(/[^0-9]/g, '')) || price;
            // await this.writeDebugLog('할인가: ' + salePrice);

            // 제조국 추출 시도
            const madeInEl = $item.find('li:contains("제조국") span:last');
            const madeIn = madeInEl.text().trim();
            // await this.writeDebugLog('제조국: ' + madeIn);

            // 이미지 URL 추출 시도 - 수정된 부분
            const prdThumbEl = $item.find('img.prdthumb');
            let imageUrl = prdThumbEl.attr('src') || '';

            if (imageUrl && !imageUrl.startsWith('http')) {
                imageUrl = imageUrl.startsWith('//') ? 'https:' + imageUrl : 'https://vintagetalk.co.kr' + imageUrl;
            }
            // await this.writeDebugLog('이미지 URL: ' + imageUrl);

            // 치수 정보 추출 시도
            const sizeEl = $item.find('li:contains("SIZE")');
            const lastLiEl = $item.find('li').last();
            const measurementText = sizeEl.text().trim() || lastLiEl.text().trim();

            const measurements = {};
            const measurementParts = measurementText.split(' ');

            // forEach를 for...of로 변경
            const measurementKeys = ['어깨', '가슴', '소매', '총장'];
            for (const key of measurementKeys) {
                const index = measurementParts.indexOf(key);
                if (index !== -1 && measurementParts[index + 1] === ':') {
                    const value = parseInt(measurementParts[index + 2]) || '';
                    measurements[key] = value;
                    // await this.writeDebugLog(`치수 ${key}: ${value}`);
                }
            }

            // 링크 추출
            const link = anchorBox.attr('href');
            const fullLink = link ? `${this.baseUrl}${link}` : '';
            // await this.writeDebugLog('링크: ' + fullLink);
            // 상품 상세 페이지 크롤링
            let stock_number = 0;
            if (imageUrl) {
                try {
                    const detailUrl = fullLink;
                    const detailResponse = await axios.get(detailUrl);
                    const $detail = cheerio.load(detailResponse.data);
                    
                    // 품절 이미지 확인
                    const soldOutImg = $detail('.xans-element-.xans-product.xans-product-detail .icon img[alt="품절"]');
                    stock_number = soldOutImg.length > 0 ? 1 : 0;
                } catch (error) {
                    await this.writeDebugLog(`상세 페이지 크롤링 실패: ${error.message}`, 'error');
                }
            }
            const result = {
                product_no: parseInt(productNo),
                product_name: productName,
                brand: brand,
                price: price,
                sale_price: salePrice,
                made_in: madeIn,
                measurements: JSON.stringify({
                    shoulder: measurements.어깨 || '',
                    chest: measurements.가슴 || '',
                    sleeve: measurements.소매 || '',
                    total_length: measurements.총장 || ''
                }),
                image_url: imageUrl,
                link: fullLink,
                register_date: new Date().toISOString(),
                hit_count: 0,
                stock_number: stock_number
            };

            // 최종 결과 로깅
            // await this.writeDebugLog('=== 파싱 결과 ===');
            // await this.writeDebugLog(JSON.stringify(result, null, 2));
            // await this.writeDebugLog('=== 파싱 결과 끝 ===\n');

            // // 데이터베이스 저장 전 로깅 추가
            // await this.writeDebugLog('=== 데이터베이스 저장 전 데이터 ===');
            // await this.writeDebugLog(JSON.stringify({
            //     product_no: result.product_no,
            //     product_name: result.product_name,
            //     brand: result.brand,
            //     price: result.price,
            //     sale_price: result.sale_price,
            //     made_in: result.made_in,
            //     measurements: result.measurements,
            //     image_url: result.image_url,
            //     link: result.link
            // }, null, 2));
            // await this.writeDebugLog('=== 데이터베이스 저장 전 데이터 끝 ===\n');

            // 현재 상품 로그 파일 닫기
            this.currentProductLog = null;

            return result;
        } catch (error) {
            await this.writeDebugLog(`상품 파싱 실패: ${error.message}`, 'error');
            await this.logFailedItem($(element).html(), error.message);
            throw error;
        }
    }

    async crawlPage(params, page) {
        try {
            this.log(`페이지 ${page} 크롤링 중...`);

            const url = `${this.baseUrl}?page=${page}&category_no=${params.display_group}`;
            const response = await axios.get(url);
            const $ = cheerio.load(response.data);

            // Find all product items in the page
            const productItems = $('.xans-product-normalpackage .PrdItem');
            const totalItems = productItems.length;
            let savedCount = 0;
            let existingCount = 0;

            this.log(`페이지 ${page}에서 ${totalItems}개의 상품 발견`);

            for (let i = 0; i < productItems.length; i++) {
                if (this.isStopped) {
                    this.log('크롤링이 중지되었습니다.');
                    break;
                }

                try {
                    const product = await this.parseProduct($, productItems[i]);
                    if (!product.product_no) {
                        this.log('상품 번호가 없는 항목 건너뜀');
                        continue;
                    }

                    const exists = await db.checkProductExists(product.product_no);
                    if (exists) {
                        existingCount++;
                        this.log(`이미 존재하는 상품: ${product.product_no} (${product.product_name})`);
                        continue;
                    }

                    const result = await db.saveProduct(product);
                    if (result.saved) {
                        savedCount++;
                        this.log(`신규 상품 저장: ${product.product_name} (${product.product_no})`);
                    }
                } catch (error) {
                    this.log(`상품 처리 실패 (${error.message})`);
                }
            }

            const summary = {
                totalItems,
                savedCount,
                existingCount,
                failedCount: totalItems - (savedCount + existingCount)
            };

            this.log(`페이지 ${page} 완료 - 총 ${summary.totalItems}개 중 ${summary.savedCount}개 저장, ${summary.existingCount}개 기존 상품, ${summary.failedCount}개 실패`);

            return summary;
        } catch (error) {
            this.log(`페이지 ${page} 크롤링 실패: ${error.message}`);
            return {
                totalItems: 0,
                savedCount: 0,
                existingCount: 0,
                failedCount: 0
            };
        }
    }

    async start(params) {
        try {
            this.isStopped = false;
            this.log('크롤링 시작');

            let totalStats = {
                totalItems: 0,
                savedCount: 0,
                existingCount: 0,
                failedCount: 0
            };

            for (let page = params.start_page; page <= params.end_page; page++) {
                if (this.isStopped) break;

                const pageStats = await this.crawlPage(params, page);
                totalStats.totalItems += pageStats.totalItems;
                totalStats.savedCount += pageStats.savedCount;
                totalStats.existingCount += pageStats.existingCount;
                totalStats.failedCount += pageStats.failedCount;
            }

            this.log('크롤링 완료');
            this.log(`총 결과: ${totalStats.totalItems}개 상품 중`);
            this.log(`- ${totalStats.savedCount}개 신규 저장`);
            this.log(`- ${totalStats.existingCount}개 기존 상품`);
            this.log(`- ${totalStats.failedCount}개 처리 실패`);

            return totalStats;
        } catch (error) {
            this.log(`크롤링 중 오류 발생: ${error.message}`);
            throw error;
        }
    }
}

module.exports = NewCrawler;
