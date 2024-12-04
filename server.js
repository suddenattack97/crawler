const express = require('express');
const cron = require('node-cron');
const path = require('path');
const db = require('./database');
const VintageCrawler = require('./crawler');
const NewCrawler = require('./new-crawler');

const app = express();
const port = 2200;

// Views 경로 설정
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// 정적 파일 제공
app.use(express.static('public'));

let activeCrawler = null;

// 크롤러 팩토리 함수
function createCrawler(type) {
    switch(type) {
        case 'vintage':
            return new VintageCrawler();
        case 'newCrawler':
            return new NewCrawler();
        default:
            throw new Error('Unknown crawler type');
    }
}

// 매일 자정에 크롤링 실행
cron.schedule('0 0 * * *', () => {
    const crawler = createCrawler('vintage');
    crawler.start();
});

// 라우트 설정
app.get('/', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const pageSize = 20;
    
    const searchParams = {
        names: req.query.names ? (Array.isArray(req.query.names) ? req.query.names : [req.query.names]) : [],
        minPrice: req.query.minPrice || '',
        maxPrice: req.query.maxPrice || ''
    };

    try {
        const [totalCount, products] = await Promise.all([
            db.getTotalProductCount(searchParams),
            db.getProductsWithPaging(page, pageSize, searchParams)
        ]);

        const totalPages = Math.ceil(totalCount / pageSize);

        res.render('index', { 
            products,
            searchParams,
            pagination: {
                currentPage: page,
                totalPages,
                totalCount,
                pageSize
            }
        });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).send('Database error');
    }
});

// 크롤러 관리 페이지
app.get('/crawler', (req, res) => {
    // 각 크롤러의 파라미터 정보 가져오기
    const crawlerParams = {
        vintage: new VintageCrawler().getParameters?.() || [],
        newCrawler: new NewCrawler().getParameters?.() || []
    };
    
    res.render('crawler', { crawlerParams });
});

// 크롤러 파라미터 정보 엔드포인트
app.get('/crawler/params/:type', (req, res) => {
    try {
        const crawler = createCrawler(req.params.type);
        const params = crawler.getParameters?.() || [];
        res.json(params);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 크롤링 중지 엔드포인트
app.post('/crawl/stop', (req, res) => {
    if (activeCrawler) {
        activeCrawler.stop();
        res.json({ message: '크롤링 중지 요청이 전송되었습니다.' });
    } else {
        res.status(400).json({ message: '실행 중인 크롤링이 없습니다.' });
    }
});

// Server-Sent Events 엔드포인트
app.get('/crawl/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const crawlerType = req.query.crawler_type || 'vintage';
    console.log('크롤링 시작:', { crawlerType, params: req.query });

    try {
        // 크롤러 생성
        activeCrawler = createCrawler(crawlerType);
        console.log('크롤러 생성 완료:', crawlerType);

        // 크롤링 파라미터 설정
        const params = {};
        if (req.query) {
            Object.keys(req.query).forEach(key => {
                if (key !== 'crawler_type') {
                    params[key] = req.query[key];
                }
            });
        }
        
        const startPage = parseInt(req.query.start_page) || 1;
        const endPage = parseInt(req.query.end_page) || 10;
        
        console.log('크롤링 파라미터:', { params, startPage, endPage });

        // 로그 콜백 설정
        activeCrawler.setLogCallback((message) => {
            console.log('크롤링 로그:', message);
            res.write(`data: ${JSON.stringify({ message, status: 'running' })}\n\n`);
        });

        // 크롤링 시작
        activeCrawler.start(params, startPage, endPage)
            .then((stats) => {
                console.log('크롤링 완료:', stats);
                res.write(`data: ${JSON.stringify({ 
                    message: activeCrawler.isStopped ? '크롤링이 중지되었습니다.' : '크롤링이 완료되었습니다.', 
                    status: activeCrawler.isStopped ? 'stopped' : 'completed',
                    stats
                })}\n\n`);
                activeCrawler = null;
                res.end();
            })
            .catch(error => {
                console.error('크롤링 오류:', error);
                res.write(`data: ${JSON.stringify({ 
                    message: `크롤링 중 오류 발생: ${error.message}`, 
                    status: 'error' 
                })}\n\n`);
                activeCrawler = null;
                res.end();
            });
    } catch (error) {
        console.error('크롤러 생성 오류:', error);
        res.write(`data: ${JSON.stringify({ 
            message: `크롤러 생성 중 오류 발생: ${error.message}`, 
            status: 'error' 
        })}\n\n`);
        res.end();
    }
});

async function startServer() {
    try {
        // 데이터베이스 초기화는 주석 처리 (기존 데이터 유지)
        // await db.initDatabase();
        
        // 서버 시작
        app.listen(port, () => {
            console.log(`Server running at http://localhost:${port}`);
        });
    } catch (error) {
        console.error('서버 시작 중 오류:', error);
        process.exit(1);
    }
}

// 서버 시작
startServer();
