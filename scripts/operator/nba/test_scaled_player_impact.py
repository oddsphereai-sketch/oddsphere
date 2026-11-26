"""Independent covariance/gradient/ridge and original training controls for C6."""
import copy
import math
import unittest
import numpy as np
from numpy.testing import assert_allclose
from scipy.linalg import cho_factor, cho_solve
from scaled_player_impact import fit, likelihood, scale_matrix, spectrum, training_rows


class ScaledPlayerImpactTests(unittest.TestCase):
    def source(self):
        rng = np.random.default_rng(20261126)
        x = rng.normal(size=(19, 6))
        y = x@np.array([2., -1., .4, 0., .2, -.1])+rng.normal(size=len(x))
        return x, y

    def dense(self, logp, x, y):
        weight, noise = np.exp(logp)
        factor = cho_factor(weight*x@x.T+noise*np.eye(len(x)), lower=True)
        return .5*(len(x)*math.log(2*math.pi)+2*np.log(np.diag(factor[0])).sum()+y@cho_solve(factor, y))

    def test_uncentered_likelihood_and_gradient_match_dense_covariance(self):
        x, y = self.source()
        y += 2.
        args = spectrum(x, y)[:4]
        p = np.log([2., 3.])
        value, grad = likelihood(p, *args)
        self.assertAlmostEqual(value, self.dense(p, x, y), places=10)
        numerical = [(self.dense(p+np.eye(2)[i]*1e-5, x, y)-self.dense(p-np.eye(2)[i]*1e-5, x, y))/2e-5 for i in range(2)]
        assert_allclose(grad, numerical, atol=1e-8, rtol=1e-7)

    def test_fitted_posterior_matches_ridge_and_dual_predictions(self):
        x, y = self.source()
        fitted, diagnostics = fit(x, y)
        self.assertTrue(diagnostics['success'])
        beta = np.linalg.solve(x.T@x+np.eye(6)*fitted['alpha'], x.T@y)
        assert_allclose(beta, fitted['coefficients'], atol=1e-10, rtol=1e-10)
        dual = x.T@np.linalg.solve(x@x.T+np.eye(len(x))*fitted['alpha'], y)
        assert_allclose(beta, dual, atol=1e-10, rtol=1e-10)
        self.assertEqual(float(np.zeros(6)@beta), 0.)

    def test_scaling_is_unit_invariant_and_preserves_zero_shock(self):
        x, _ = self.source()
        a, scale = scale_matrix(x)
        b, changed_scale = scale_matrix(x*np.array([1000., .001, 3., 2., 8., .5]))
        assert_allclose(a, b, atol=1e-15, rtol=1e-15)
        self.assertFalse(np.allclose(a.mean(axis=0), 0.))
        assert_allclose(np.zeros(6)/scale, np.zeros(6), atol=0.)
        self.assertTrue((changed_scale > 0).all())

    def test_zero_column_stays_zero_coefficient_and_rank_matches_dense(self):
        x, y = self.source()
        x[:, 0] = 0.
        x[:, 1] = x[:, 2]
        x, scale = scale_matrix(x)
        self.assertEqual(scale[0], 1.)
        fitted, diagnostics = fit(x, y)
        self.assertEqual(fitted['coefficients'][0], 0.)
        self.assertEqual(diagnostics['numericalRank'], 4)
        p = np.log([.3, 2.])
        self.assertAlmostEqual(likelihood(p, *spectrum(x, y)[:4])[0], self.dense(p, x, y), places=10)

    def test_later_outcomes_and_features_cannot_enter_training(self):
        train = [{'gameId': str(i), 'season': 2022, 'finalAvailableAt': '2023-01-01T00:00:00Z',
                  'baselineHash': 'a', 'sourceSchemaHash': 's', 'features': [1.]*6} for i in range(20)]
        data = {'rows': train+[{'season': 2025, 'features': 'poison'}], 'trainingRows': 20,
                'firstEvaluation': '2023-10-01T00:00:00Z', 'trainingBaselineHash': 'a', 'sourceSchemaHash': 's'}
        before = copy.deepcopy(data)
        expected = training_rows(data)
        data['rows'][-1] = {'season': 2023, 'actualMargin': object(), 'features': None}
        self.assertEqual(expected, training_rows(data))
        self.assertEqual(before['rows'][:-1], data['rows'][:-1])
        data['firstEvaluation'] = '2023-10-01T01:00:00+01:00'
        self.assertEqual(expected, training_rows(data))
        data['rows'][0]['finalAvailableAt'] = '2024-01-01T00:00:00Z'
        with self.assertRaises(ValueError):
            training_rows(data)


if __name__ == '__main__':
    unittest.main()
