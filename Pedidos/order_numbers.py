"""Numeric order references shared by production and the isolated factory core."""
import re


ORDER_NUMBER_PATTERN = r'(?:[0-9]+|SP-D-[0-9]{6})'


def valid_order_number(value):
    return re.fullmatch(ORDER_NUMBER_PATTERN, value) is not None


def next_order_number(db):
    """Call inside the caller's write transaction; include deleted orders."""
    highest = 29999
    for (number,) in db.execute('SELECT number FROM orders WHERE number IS NOT NULL'):
        if re.fullmatch(r'[0-9]+', str(number)):
            highest = max(highest, int(number))
    return str(highest + 1)
