import sqlite3
import csv
import os

db_path = '/Users/justinlai/osm-ai/data/restobase.sqlite'
csv_path = '/Users/justinlai/osm-ai/pending-import/data.csv'

def is_true(val):
    if not val:
        return 0
    val = val.strip().upper()
    return 1 if val in ['X', 'TRUE', '1', 'CHECKED', 'YES'] else 0

def import_csv():
    if not os.path.exists(csv_path):
        print(f"Error: CSV file not found at {csv_path}")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    with open(csv_path, mode='r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        
        inserted_count = 0
        for row in reader:
            name = row.get('餐廳名稱') or row.get('name')
            if not name:
                continue
            
            region = row.get('Region') or row.get('地區') or row.get('region')
            tag = row.get('Tag') or row.get('tag')
            rating = float(row.get('Google評分') or row.get('rating') or 0)
            description = row.get('點解推介呢間餐廳') or row.get('description')
            
            booking = is_true(row.get('訂座') or row.get('booking_available'))
            queuing = is_true(row.get('排隊') or row.get('queuing_available'))
            delivery = is_true(row.get('外賣') or row.get('phone_order_available'))
            
            # Using NULL for phone_number and address as they are not in CSV
            cursor.execute('''
                INSERT INTO restaurants (region, rating, tag, name, phone_number, address, description, booking_available, queuing_available, phone_order_available)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (region, rating, tag, name, None, None, description, booking, queuing, delivery))
            inserted_count += 1
            
    conn.commit()
    conn.close()
    print(f"Successfully imported {inserted_count} restaurants into the database.")

if __name__ == "__main__":
    import_csv()
