import copy
import unittest
import numpy as np
from numpy.testing import assert_allclose
from regulation_pace_total import prepare_design, solve, training_rows


class RegulationPaceTotalTests(unittest.TestCase):
    def rows(self):
        names = [f'pace48_{i}' if i < 13 else f'feature_{i}' for i in range(75)]
        rng = np.random.default_rng(20261127)
        rows = [{'gameId': str(i), 'season': 2022, 'finalAvailableAt': '2023-01-01T00:00:00Z',
                 'durationAwareFeatures': dict(zip(names, rng.normal(size=75)))} for i in range(90)]
        rows[0]['durationAwareFeatures'][names[0]] = None
        return names, rows

    def test_ridge_matches_full_intercept_and_dual_solutions(self):
        names, rows = self.rows()
        x, _ = prepare_design(rows, names)
        y = np.arange(len(rows), dtype=float)+200
        beta = solve(x, y)
        design = np.column_stack([x, np.ones(len(x))])
        penalty = np.diag([1000.]*x.shape[1]+[0.])
        full = np.linalg.solve(design.T@design+penalty, design.T@y)
        assert_allclose(beta, full, atol=1e-10, rtol=1e-10)
        dual = x.T@np.linalg.solve(x@x.T+1000*np.eye(len(x)), y-y.mean())
        assert_allclose(beta[:-1], dual, atol=1e-10, rtol=1e-10)

    def test_training_only_imputation_scaling_and_source_immutability(self):
        names, rows = self.rows()
        before = copy.deepcopy(rows)
        x, design = prepare_design(rows, names)
        self.assertEqual(rows, before)
        self.assertEqual(design['missingIndicatorColumns'], [names[0]])
        self.assertAlmostEqual(design['rawFeatureMedians'][0], np.median([r['durationAwareFeatures'][names[0]] for r in rows[1:]]))
        assert_allclose(x.mean(axis=0), np.zeros(x.shape[1]), atol=1e-14)

    def test_later_outcomes_and_duration_features_do_not_enter_training(self):
        _, rows = self.rows()
        source = {'rows': rows+[{'season': 2025, 'durationAwareFeatures': 'poison'}],
                  'trainingRows': len(rows), 'firstEvaluation': '2023-10-01T00:00:00Z'}
        before = training_rows(source)
        source['rows'][-1] = {'season': 2023, 'durationAwareFeatures': None, 'actualTotal': object()}
        self.assertEqual(before, training_rows(source))
        source['firstEvaluation'] = '2023-10-01T01:00:00+01:00'
        self.assertEqual(before, training_rows(source))

    def test_declared_feature_contract_and_incomplete_training_fail(self):
        names, rows = self.rows()
        with self.assertRaises(ValueError):
            prepare_design(rows, names[:74])
        with self.assertRaises(ValueError):
            prepare_design(rows, ['other']*75)
        with self.assertRaises(ValueError):
            training_rows({'rows': rows[:-1], 'trainingRows': len(rows), 'firstEvaluation': '2023-10-01T00:00:00Z'})


if __name__ == '__main__':
    unittest.main()
