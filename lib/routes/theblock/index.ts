import { Route, Data } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import { load } from 'cheerio';
import logger from '@/utils/logger';

export const route: Route = {
    path: '/category/:category',
    categories: ['finance'],
    example: '/theblock/category/crypto-ecosystems',
    parameters: { category: 'News category' },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: 'Category',
    maintainers: ['pseudoyu'],
    handler,
    radar: [
        {
            source: ['theblock.co/category/:category'],
            target: '/category/:category',
        },
    ],
    description: 'Get latest news from TheBlock by category. Note that due to website limitations, only article summaries may be available.',
};

async function handler(ctx): Promise<Data> {
    const category = ctx.req.param('category');
    const limit = ctx.req.query('limit') ? Number.parseInt(ctx.req.query('limit')) : 10;

    const apiUrl = `https://www.theblock.co/api/category/${category}`;

    try {
        const response = await ofetch(apiUrl);

        // Extract articles from the nested data structure
        const articles = response.data?.articles || [];

        if (!articles.length) {
            throw new Error(`No articles found for category: ${category}`);
        }

        const items = await Promise.all(
            articles.slice(0, limit).map((article) =>
                cache.tryGet(`theblock:article:${article.url}`, async () => {
                    try {
                        // Try to get the full article
                        const articleResponse = await ofetch(`https://www.theblock.co/api/post/${article.id}/`);

                        const post = articleResponse.post;
                        const $ = load(post.body, null, false);

                        // If we successfully got the article content
                        if (post.body.length) {
                            // Remove unwanted elements
                            $('.copyright').remove();

                            let fullText = '';

                            if (article.thumbnail) {
                                fullText += `<p><img src="${post.thumbnail}" alt="${article.title}"></p>`;
                            }
                            fullText += post.intro + $.html();

                            if (fullText) {
                                return {
                                    title: article.title,
                                    link: article.url,
                                    pubDate: parseDate(post.published),
                                    description: fullText,
                                    author: article.authors?.map((a) => a.name).join(', ') || 'TheBlock',
                                    category: [...new Set([post.categories.name, ...post.categories.map((cat) => cat.name), ...post.tags.map((tag) => tag.name)])],
                                    guid: article.url,
                                    image: article.thumbnail,
                                };
                            }
                        }

                        // If we couldn't extract specific content, fall back to a summary-based approach
                        logger.info(`Using summary-based approach for article: ${article.url}`);
                        return createSummaryItem(article);
                    } catch (error: any) {
                        // If we got a 403 error or any other error, use summary approach
                        logger.warn(`Couldn't fetch full content for ${article.url}: ${error.message}`);
                        return createSummaryItem(article);
                    }
                })
            )
        );

        return {
            title: `TheBlock - ${category.charAt(0).toUpperCase() + category.slice(1).replaceAll('-', ' ')}`,
            link: `https://www.theblock.co/category/${category}`,
            item: items,
            description: `Latest articles from TheBlock in the ${category} category`,
            language: 'en',
        } as Data;
    } catch (error: any) {
        logger.error(`Error in TheBlock handler: ${error.message}`);
        throw error;
    }
}

// Helper function to create a summary-based item when full content isn't available
function createSummaryItem(article: any) {
    let description = '';

    // Add thumbnail if available
    if (article.thumbnail) {
        description += `<p><img src="${article.thumbnail}" alt="${article.title}"></p>`;
    }

    // Add subheading if available
    if (article.subheading) {
        description += `<p><strong>${article.subheading}</strong></p>`;
    }

    // Add preview if available
    if (article.preview) {
        description += `<p>${article.preview}</p>`;
    }

    // Add link to original article
    description += `<p><a href="${article.url}">Read the full article at TheBlock</a></p>`;

    return {
        title: article.title,
        link: article.url,
        pubDate: parseDate(article.publishedFormatted, 'MMMM D, YYYY, h:mmA [EST]'),
        description,
        author: article.authors?.map((a) => a.name).join(', ') || 'TheBlock',
        category: article.primaryCategory?.name || [],
        guid: article.url,
        image: article.thumbnail,
    };
}
