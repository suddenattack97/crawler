const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_FILE = 'vintage.db';
const DB_PATH = path.join(__dirname, DB_FILE);

// 기존 데이터베이스 연결 유지
const db = new sqlite3.Database(DB_PATH);

// 데이터베이스 완전 초기화 (주석 처리)
/*
async function resetDatabase() {
    return new Promise((resolve, reject) => {
        // 기존 연결 닫기
        db.close((err) => {
            if (err) {
                console.error('데이터베이스 연결 닫기 실패:', err);
                reject(err);
                return;
            }

            try {
                // 기존 데이터베이스 파일이 있으면 삭제
                if (fs.existsSync(DB_PATH)) {
                    fs.unlinkSync(DB_PATH);
                    console.log('기존 데이터베이스 삭제됨');
                }

                // 새 데이터베이스 연결
                db = new sqlite3.Database(DB_PATH);
                console.log('새 데이터베이스 생성됨');
                resolve(db);
            } catch (error) {
                console.error('데이터베이스 초기화 중 오류:', error);
                reject(error);
            }
        });
    });
}
*/

// 데이터베이스 초기화 (주석 처리)
/*
async function initDatabase() {
    try {
        await resetDatabase();
        
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                // 상품 테이블 생성
                db.run(`CREATE TABLE IF NOT EXISTS products (
                    product_no INTEGER PRIMARY KEY,
                    product_name TEXT,
                    brand TEXT,
                    price INTEGER,
                    sale_price INTEGER,
                    made_in TEXT,
                    measurements TEXT,
                    image_url TEXT,
                    link TEXT,
                    register_date TEXT,
                    hit_count INTEGER,
                    stock_number TEXT
                )`, (err) => {
                    if (err) {
                        console.error('테이블 생성 중 오류:', err);
                        reject(err);
                    } else {
                        console.log('데이터베이스 초기화 완료');
                        resolve();
                    }
                });
            });
        });
    } catch (error) {
        console.error('데이터베이스 초기화 중 오류:', error);
        throw error;
    }
}
*/

// 상품 번호로 존재 여부 확인
function checkProductExists(product_no) {
    return new Promise((resolve, reject) => {
        db.get("SELECT product_no FROM products WHERE product_no = ?", [product_no], (err, row) => {
            if (err) reject(err);
            else resolve(!!row);
        });
    });
}

// 상품 저장 (Promise 버전)
async function saveProduct(product) {
    const exists = await checkProductExists(product.product_no);
    if (exists) {
        return { saved: false, product_no: product.product_no };
    }

    return new Promise((resolve, reject) => {
        const stmt = db.prepare(`
            INSERT INTO products (
                product_no, product_name, brand, price, sale_price, 
                made_in, measurements, image_url, link, register_date, 
                hit_count, stock_number
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            product.product_no,
            product.product_name,
            product.brand,
            product.price,
            product.sale_price,
            product.made_in,
            product.measurements,
            product.image_url,
            product.link,
            product.register_date,
            product.hit_count,
            product.stock_number,
            (err) => {
                stmt.finalize();
                if (err) {
                    console.error('데이터베이스 저장 중 오류:', err);
                    console.error('저장하려던 데이터:', product);
                    reject(err);
                } else {
                    resolve({ saved: true, product_no: product.product_no });
                }
            }
        );
    });
}

// 상품 조회
function getProducts(callback) {
    db.all("SELECT * FROM products", [], (err, rows) => {
        callback(err, rows);
    });
}

// 브랜드별 상품 조회
function getProductsByBrand(brand, callback) {
    db.all("SELECT * FROM products WHERE brand = ?", [brand], (err, rows) => {
        callback(err, rows);
    });
}

// 상품 검색
function searchProducts(params, callback) {
    let query = "SELECT * FROM products WHERE 1=1";
    const queryParams = [];

    if (params.names && params.names.length > 0) {
        const nameConditions = params.names.map(name => {
            values.push(`%${name}%`);
            return `(product_name LIKE ?)`;
        });
        query += ` AND (${nameConditions.join(' AND ')})`;
    }

    if (params.minPrice) {
        query += " AND sale_price >= ?";
        queryParams.push(parseInt(params.minPrice));
    }

    if (params.maxPrice) {
        query += " AND sale_price <= ?";
        queryParams.push(parseInt(params.maxPrice));
    }

    db.all(query, queryParams, (err, rows) => {
        callback(err, rows);
    });
}

// 전체 상품 수 조회
function getTotalProductCount(params = {}) {
    return new Promise((resolve, reject) => {
        let conditions = [];
        let values = [];

        // 검색어 조건 추가
        if (params.names && params.names.length > 0) {
            const nameConditions = params.names.map(name => {
                values.push(`%${name}%`);
                return `(product_name LIKE ?)`;
            });
            conditions.push(`(${nameConditions.join(' AND ')})`);
        }

        // 가격 범위 조건 추가
        if (params.minPrice) {
            conditions.push('sale_price >= ?');
            values.push(params.minPrice);
        }
        if (params.maxPrice) {
            conditions.push('sale_price <= ?');
            values.push(params.maxPrice);
        }

        // 품절 상품 제외 조건 추가
        if (params.excludeSoldOut) {
            conditions.push('(stock_number IS NULL OR stock_number != "1")');
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const query = `SELECT COUNT(*) as count FROM products ${whereClause}`;

        db.get(query, values, (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(row.count);
        });
    });
}

// 페이징된 상품 조회
function getProductsWithPaging(page = 1, pageSize = 20, params = {}) {
    return new Promise((resolve, reject) => {
        const offset = (page - 1) * pageSize;
        let conditions = [];
        let values = [];

        // 검색어 조건 추가
        if (params.names && params.names.length > 0) {
            const nameConditions = params.names.map(name => {
                values.push(`%${name}%`);
                return `(product_name LIKE ?)`;
            });
            conditions.push(`(${nameConditions.join(' AND ')})`);
        }

        // 가격 범위 조건 추가
        if (params.minPrice) {
            conditions.push('sale_price >= ?');
            values.push(params.minPrice);
        }
        if (params.maxPrice) {
            conditions.push('sale_price <= ?');
            values.push(params.maxPrice);
        }

        // 품절 상품 제외 조건 추가
        if (params.excludeSoldOut) {
            conditions.push('(stock_number IS NULL OR stock_number != "1")');
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const query = `
            SELECT *
            FROM products
            ${whereClause}
            ORDER BY register_date DESC
            LIMIT ? OFFSET ?
        `;

        values.push(pageSize, offset);

        db.all(query, values, (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(rows);
        });
    });
}

module.exports = {
    saveProduct,
    getProducts,
    searchProducts,
    checkProductExists,
    getTotalProductCount,
    getProductsWithPaging
};
