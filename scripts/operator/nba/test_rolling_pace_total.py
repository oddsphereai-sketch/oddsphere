import copy
import unittest
from rolling_pace_total import rows_for_origin


class RollingPaceAdmissionTests(unittest.TestCase):
    def source(self):
        return {'rows': [{'gameId': str(i), 'season': 2022, 'finalAvailableAt': '2023-01-01T00:00:00Z', 'actualTotal': i} for i in range(1000)] +
                [{'gameId': 'target', 'season': 2023, 'cutoff': '2023-10-01T00:00:00Z', 'actualTotal': 200}]}

    def test_target_and_later_poison_cannot_enter_training(self):
        source = self.source()
        before = copy.deepcopy(source)
        cutoff, rows = rows_for_origin(source, 2023)
        self.assertEqual(before, source)
        source['rows'][-1]['actualTotal'] = object()
        source['rows'].append({'gameId': 'later', 'season': 2025, 'actualTotal': object()})
        self.assertEqual((cutoff, rows), rows_for_origin(source, 2023))

    def test_late_prior_final_and_duplicate_ids_fail_closed(self):
        source = self.source()
        source['rows'][0]['finalAvailableAt'] = '2023-10-01T01:00:00+01:00'
        with self.assertRaises(ValueError):
            rows_for_origin(source, 2023)
        source = self.source()
        source['rows'][0]['gameId'] = source['rows'][1]['gameId']
        with self.assertRaises(ValueError):
            rows_for_origin(source, 2023)


if __name__ == '__main__':
    unittest.main()
