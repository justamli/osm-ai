import csv

region_map = {
    '上環': 'Sheung Wan',
    '中環': 'Central',
    '九龍城': 'Kowloon City',
    '元朗': 'Yuen Long',
    '北角': 'North Point',
    '大埔': 'Tai Po',
    '天水圍': 'Tin Shui Wai',
    '將軍澳': 'Tseung Kwan O',
    '尖沙咀': 'Tsim Sha Tsui',
    '屯門': 'Tuen Mun',
    '旺角': 'Mong Kok',
    '沙田': 'Sha Tin',
    '深水埗': 'Sham Shui Po',
    '灣仔': 'Wan Chai',
    '荃灣': 'Tsuen Wan',
    '西環': 'Sai Wan',
    '西貢': 'Sai Kung',
    '觀塘': 'Kwun Tong',
    '赤柱': 'Stanley',
    '銅鑼灣': 'Causeway Bay',
    '地區': 'Region'
}

tag_map = {
    '上海菜': 'Shanghainese',
    '中式糕點': 'Chinese Pastries',
    '串燒': 'Skewers',
    '京菜': 'Beijing Cuisine',
    '刺身': 'Sashimi',
    '台灣菜': 'Taiwanese',
    '咖啡': 'Coffee',
    '大排檔': 'Dai Pai Dong',
    '小食': 'Snacks',
    '川菜': 'Sichuan',
    '德國菜': 'German',
    '意大利菜': 'Italian',
    '懷舊': 'Nostalgic',
    '拉麵': 'Ramen',
    '日本菜': 'Japanese',
    '法式中菜': 'French-Chinese Fusion',
    '泰國菜': 'Thai',
    '海鮮': 'Seafood',
    '滬菜': 'Shanghainese (Hu)',
    '漢堡': 'Burger',
    '潮州菜': 'Teochew',
    '火鍋': 'Hot Pot',
    '煲仔飯': 'Claypot Rice',
    '燒味': 'Roast Meat',
    '燒肉': 'Yakiniku',
    '牛扒': 'Steak',
    '甜品': 'Dessert',
    '粉麵': 'Noodles',
    '粥店': 'Congee',
    '粵菜': 'Cantonese',
    '素食': 'Vegetarian',
    '自助餐': 'Buffet',
    '茶餐廳': 'Cha Chaan Teng',
    '薄餅': 'Pizza',
    '補身': 'Tonic',
    '西餐': 'Western',
    '連鎖': 'Chain',
    '酒吧': 'Bar',
    '雞煲': 'Chicken Pot',
    '順德菜': 'Shunde Cuisine',
    '飲品': 'Drinks',
    '餃子': 'Dumplings',
    '馬來西亞菜': 'Malaysian',
    '高級粵菜': 'Fine Dining Cantonese',
    '麵包糕點': 'Bakery',
    '點心': 'Dim Sum',
    'Tag': 'Tag'
}

input_file = '/Users/justinlai/osm-ai/pending-import/data.csv'
output_file = '/Users/justinlai/osm-ai/pending-import/data_translated.csv'

with open(input_file, mode='r', encoding='utf-8') as f:
    reader = csv.reader(f)
    rows = list(reader)

for row in rows:
    if not row:
        continue
    # Translate Region (Index 0)
    original_region = row[0]
    if original_region in region_map:
        row[0] = region_map[original_region]
    
    # Translate Tag (Index 2)
    original_tag = row[2]
    tags = original_tag.split('/')
    translated_tags = []
    for t in tags:
        if t in tag_map:
            translated_tags.append(tag_map[t])
        else:
            translated_tags.append(t)
    row[2] = '/'.join(translated_tags)

with open(output_file, mode='w', encoding='utf-8', newline='') as f:
    writer = csv.writer(f)
    writer.writerows(rows)

print(f"Translated file saved to {output_file}")
